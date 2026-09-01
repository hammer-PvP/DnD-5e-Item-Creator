import { MODULE_ID, RARITIES } from "./constants.mjs";
import {
  buildCatalog,
  entriesForProfile,
  isFirearmRelated,
  isNaturalSupplierEntry,
  nativeSubtypeLabel,
  normalizeText
} from "./catalog.mjs";
import { itemGroupMatchesEntry, normalizeItemGroup } from "./profile-v2.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function titleCase(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function sourceLabel(entry) {
  return `${entry.packLabel} — ${entry.packageName || entry.packId}`;
}

function rows(values, selected = [], label = titleCase) {
  const chosen = new Set((selected ?? []).map(String));
  return [...new Set(values.filter(Boolean).map(String))]
    .sort((a, b) => label(a).localeCompare(label(b)))
    .map(value => ({ value, label: label(value), checked: chosen.has(value) }));
}

function commaList(value) {
  return String(value ?? "").split(",").map(item => item.trim()).filter(Boolean);
}

export class SupplierItemGroupPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dnd5e-item-creator-supplier-item-group-picker",
    classes: ["dnd5e-supplier", "dnd5e-supplier-picker", "supplier-item-group-picker"],
    position: { width: 980, height: 840 },
    window: {
      title: "DND5E_SUPPLIER.ProfileV2.ItemGroupBuilder",
      icon: "fa-solid fa-layer-group",
      resizable: true
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/supplier/item-group-picker.hbs` }
  };

  constructor({ profile, group, configuration, onSave } = {}, options = {}) {
    super(options);
    this.profile = foundry.utils.deepClone(profile);
    this.group = normalizeItemGroup(foundry.utils.deepClone(group));
    this.configuration = foundry.utils.deepClone(configuration);
    this.onSave = onSave;
    this.search = "";
    this.restoreScrollTop = null;
  }

  async _prepareContext() {
    const catalog = await buildCatalog({ configurationOverride: this.configuration });
    const entries = entriesForProfile(catalog, this.profile, this.configuration, { includeBanned: false, includeMechanical: false })
      .filter(entry => entry.type !== "spell")
      .filter(entry => !isNaturalSupplierEntry(entry));

    // Keep firearm documents visible in the builder even when normalization is
    // enabled. A GM may deliberately define a firearm group and let the Supplier
    // normalize that group to medieval crossbows/ammunition at generation time.
    // Hiding the source documents here would make the profile-level toggle
    // impossible to configure transparently.
    const sourceOptions = [...new Map(entries.map(entry => [entry.packId, sourceLabel(entry)])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]));
    // Evaluate the dynamic filter itself independently from explicit per-item
    // exclusions. Excluded documents must remain visible in the Builder so a
    // GM can review/re-enable exceptions after using a broad dynamic filter.
    const dynamicFilterGroup = { ...this.group, selectionMode: "dynamic", excludedUuids: [] };
    const dynamicMatches = entries.filter(entry => itemGroupMatchesEntry(dynamicFilterGroup, entry));
    const dynamicKeys = new Set(dynamicMatches.map(entry => entry.uuid));
    const selected = new Set(this.group.selectedUuids ?? []);
    const excluded = new Set(this.group.excludedUuids ?? []);
    const c = this.group.crafting ?? {};

    const sourceFilteredEntries = this.group.sourceIds?.length
      ? entries.filter(entry => this.group.sourceIds.includes(entry.packId)
        || (entry.sourceVariants ?? []).some(variant => this.group.sourceIds.includes(variant.packId)))
      : entries;
    const typeFilteredEntries = this.group.itemTypes?.length
      ? sourceFilteredEntries.filter(entry => this.group.itemTypes.includes(entry.type))
      : sourceFilteredEntries;
    const subtypeFilteredEntries = this.group.subtypes?.length
      ? typeFilteredEntries.filter(entry => this.group.subtypes.some(subtype => (entry.subtypeKeys ?? [entry.primarySubtypeKey]).includes(subtype)))
      : typeFilteredEntries;
    const optionEntries = subtypeFilteredEntries;

    return {
      group: this.group,
      dynamicMode: this.group.selectionMode === "dynamic",
      explicitMode: this.group.selectionMode === "explicit",
      sourceOptions: [
        { value: "", label: game.i18n.localize("DND5E_SUPPLIER.ProfileV2.AllProfileSources"), selected: !this.group.sourceIds.length },
        ...sourceOptions.map(([value, label]) => ({ value, label, selected: this.group.sourceIds.length === 1 && this.group.sourceIds[0] === value }))
      ],
      typeOptions: rows(sourceFilteredEntries.map(entry => entry.type), this.group.itemTypes),
      subtypeOptions: rows(typeFilteredEntries.flatMap(entry => entry.subtypeKeys ?? [entry.primarySubtypeKey]), this.group.subtypes, nativeSubtypeLabel),
      rarityOptions: RARITIES.map(rarity => ({ value: rarity.value, label: game.i18n.localize(rarity.label), checked: (this.group.rarities ?? []).includes(rarity.value) })),
      natureOptions: rows(optionEntries.map(entry => entry.documentNature ?? "sellable"), this.group.documentNatures),
      magicalAny: this.group.magicalState === "any",
      magicalMundane: this.group.magicalState === "mundane",
      magicalMagical: this.group.magicalState === "magical",
      identityTermsText: (this.group.identityTerms ?? []).join(", "),
      identityExclusionsText: (this.group.identityExclusions ?? []).join(", "),
      materialOnly: c.materialOnly === true,
      productOnly: c.productOnly === true,
      knowledgeOnly: c.knowledgeOnly === true,
      excludeMaterials: c.excludeMaterials === true,
      excludeProducts: c.excludeProducts === true,
      excludeKnowledge: c.excludeKnowledge !== false,
      materialFamilyOptions: rows(optionEntries.map(entry => entry.craftingMaterialFamily), c.materialFamilies),
      materialNatureOptions: rows(optionEntries.map(entry => entry.craftingMaterialNature), c.materialNatures),
      materialCategoryOptions: rows(optionEntries.map(entry => entry.craftingMaterialCategory), c.materialCategories),
      materialTagOptions: rows(optionEntries.flatMap(entry => entry.craftingMaterialTags ?? []), c.materialTags),
      materialRequireOptions: rows(optionEntries.flatMap(entry => entry.craftingMaterialRequires ?? []), c.materialRequires),
      materialBiomeOptions: rows(optionEntries.flatMap(entry => entry.craftingMaterialBiomes ?? []), c.materialBiomes),
      productCategoryOptions: rows(optionEntries.map(entry => entry.craftingProductCategory), c.productCategories),
      productSubcategoryOptions: rows(optionEntries.map(entry => entry.craftingProductSubcategory), c.productSubcategories),
      productCultureOptions: rows(optionEntries.map(entry => entry.craftingProductCulture), c.productCultures),
      productMealTypeOptions: rows(optionEntries.map(entry => entry.craftingProductMealType), c.productMealTypes),
      entries: entries.map(entry => {
        const isDynamicMatch = dynamicKeys.has(entry.uuid);
        const checked = this.group.selectionMode === "explicit" ? selected.has(entry.uuid) : isDynamicMatch && !excluded.has(entry.uuid);
        return {
          ...entry,
          checked,
          dynamicMatch: isDynamicMatch,
          // Filters always narrow the visible candidate list. In explicit mode
          // the filters are a browsing aid while the checked UUIDs remain the
          // authoritative saved selection.
          hiddenByGroup: !isDynamicMatch,
          firearmNormalized: this.profile.normalizeFirearms === true && isFirearmRelated(entry),
          sourceDisplay: sourceLabel(entry),
          subtypeLabel: nativeSubtypeLabel(entry.primarySubtypeKey),
          searchText: normalizeText(`${entry.name} ${entry.identifier} ${entry.type} ${(entry.subtypeAliases ?? []).join(" ")} ${entry.packLabel} ${entry.packageName}`)
        };
      }),
      selectedCount: this.group.selectionMode === "explicit"
        ? selected.size
        : Math.max(0, dynamicMatches.length - dynamicMatches.filter(entry => excluded.has(entry.uuid)).length)
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    const preserve = () => { this.restoreScrollTop = root.querySelector(".supplier-picker-list")?.scrollTop ?? 0; };
    const rerender = () => { preserve(); this.render({ force: true }); };

    root.querySelector("[name='groupName']")?.addEventListener("input", event => { this.group.name = event.currentTarget.value; });
    root.querySelectorAll("[name='selectionMode']").forEach(input => input.addEventListener("change", () => {
      if (!input.checked) return;
      this.group.selectionMode = input.value;
      rerender();
    }));
    root.querySelector("[data-filter='source']")?.addEventListener("change", event => {
      this.group.sourceIds = event.currentTarget.value ? [event.currentTarget.value] : [];
      rerender();
    });
    root.querySelector("[data-filter='magical']")?.addEventListener("change", event => {
      this.group.magicalState = event.currentTarget.value || "any";
      rerender();
    });
    root.querySelector("[data-filter='identity']")?.addEventListener("change", event => {
      this.group.identityTerms = commaList(event.currentTarget.value);
      rerender();
    });
    root.querySelector("[data-filter='identity-exclusions']")?.addEventListener("change", event => {
      this.group.identityExclusions = commaList(event.currentTarget.value);
      rerender();
    });
    root.querySelector("[data-filter='selection-weight']")?.addEventListener("change", event => {
      this.group.selectionWeight = Math.max(0.01, Number(event.currentTarget.value) || 1);
      rerender();
    });

    const bindArray = (selector, target) => {
      root.querySelectorAll(selector).forEach(input => input.addEventListener("change", () => {
        const selectedValues = [...root.querySelectorAll(selector)].filter(item => item.checked).map(item => item.value);
        const [head, tail] = target.split(".");
        if (tail) this.group[head][tail] = selectedValues;
        else this.group[target] = selectedValues;
        rerender();
      }));
    };
    bindArray("[data-group-array='itemTypes']", "itemTypes");
    bindArray("[data-group-array='subtypes']", "subtypes");
    bindArray("[data-group-array='rarities']", "rarities");
    bindArray("[data-group-array='documentNatures']", "documentNatures");
    bindArray("[data-group-array='materialFamilies']", "crafting.materialFamilies");
    bindArray("[data-group-array='materialNatures']", "crafting.materialNatures");
    bindArray("[data-group-array='materialCategories']", "crafting.materialCategories");
    bindArray("[data-group-array='materialTags']", "crafting.materialTags");
    bindArray("[data-group-array='materialRequires']", "crafting.materialRequires");
    bindArray("[data-group-array='materialBiomes']", "crafting.materialBiomes");
    bindArray("[data-group-array='productCategories']", "crafting.productCategories");
    bindArray("[data-group-array='productSubcategories']", "crafting.productSubcategories");
    bindArray("[data-group-array='productCultures']", "crafting.productCultures");
    bindArray("[data-group-array='productMealTypes']", "crafting.productMealTypes");

    root.querySelectorAll("[data-crafting-toggle]").forEach(input => input.addEventListener("change", () => {
      const key = input.dataset.craftingToggle;
      if (!key) return;
      if (["materialOnly", "productOnly", "knowledgeOnly"].includes(key)) {
        if (input.checked) {
          this.group.crafting.materialOnly = key === "materialOnly";
          this.group.crafting.productOnly = key === "productOnly";
          this.group.crafting.knowledgeOnly = key === "knowledgeOnly";
          if (key === "knowledgeOnly") this.group.crafting.excludeKnowledge = false;
        } else this.group.crafting[key] = false;
      } else {
        this.group.crafting[key] = input.checked;
        if (key === "excludeKnowledge" && input.checked) this.group.crafting.knowledgeOnly = false;
      }
      rerender();
    }));

    const search = root.querySelector("[data-action='search']");
    const rows = [...root.querySelectorAll("[data-picker-row]")];
    const visibleCount = root.querySelector("[data-visible-count]");
    const applySearch = () => {
      this.search = normalizeText(search?.value ?? "");
      let visible = 0;
      for (const row of rows) {
        row.hidden = Boolean(row.dataset.groupHidden === "true" || (this.search && !row.dataset.search.includes(this.search)));
        if (!row.hidden) visible += 1;
      }
      if (visibleCount) visibleCount.textContent = String(visible);
    };
    if (search) search.value = this.search;
    search?.addEventListener("input", applySearch);
    applySearch();

    const updateSelection = (row, checked) => {
      const uuid = row.dataset.uuid;
      if (!uuid) return;
      if (this.group.selectionMode === "explicit") {
        const set = new Set(this.group.selectedUuids ?? []);
        checked ? set.add(uuid) : set.delete(uuid);
        this.group.selectedUuids = [...set];
      } else {
        const excluded = new Set(this.group.excludedUuids ?? []);
        checked ? excluded.delete(uuid) : excluded.add(uuid);
        this.group.excludedUuids = [...excluded];
      }
      row.classList.toggle("selected", checked);
    };
    root.querySelectorAll("[data-action='toggle-item']").forEach(input => input.addEventListener("change", () => {
      const row = input.closest("[data-picker-row]");
      if (row) updateSelection(row, input.checked);
    }));
    const setVisible = checked => {
      for (const row of rows) {
        if (row.hidden) continue;
        const input = row.querySelector("[data-action='toggle-item']");
        if (!input) continue;
        input.checked = checked;
        updateSelection(row, checked);
      }
    };
    root.querySelector("[data-action='select-visible']")?.addEventListener("click", () => setVisible(true));
    root.querySelector("[data-action='clear-visible']")?.addEventListener("click", () => setVisible(false));

    root.querySelectorAll("[data-action='open-document']").forEach(button => button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const document = await fromUuid(button.dataset.uuid);
      document?.sheet?.render(true);
    }));

    root.querySelector("[data-action='save-group']")?.addEventListener("click", async () => {
      this.group.name = String(root.querySelector("[name='groupName']")?.value ?? this.group.name).trim() || "Item Group";
      this.group.identityTerms = commaList(root.querySelector("[data-filter='identity']")?.value ?? (this.group.identityTerms ?? []).join(","));
      this.group.identityExclusions = commaList(root.querySelector("[data-filter='identity-exclusions']")?.value ?? (this.group.identityExclusions ?? []).join(","));
      this.group.selectionWeight = Math.max(0.01, Number(root.querySelector("[data-filter='selection-weight']")?.value ?? this.group.selectionWeight) || 1);
      await this.onSave?.(normalizeItemGroup(this.group));
      this.close();
    });

    if (Number.isFinite(this.restoreScrollTop)) {
      const top = this.restoreScrollTop;
      this.restoreScrollTop = null;
      requestAnimationFrame(() => {
        const list = this.element?.querySelector(".supplier-picker-list");
        if (list) list.scrollTop = top;
      });
    }
  }
}
