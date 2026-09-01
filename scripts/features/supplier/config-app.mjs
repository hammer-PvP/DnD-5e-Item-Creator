import {
  HAMMER_HOMEBREW_PROGRESSION_ID,
  MODULE_ID,
  RARITIES,
  SUPPLIER_THEMES,
  createCustomProgressionProfile,
  createHammerHomebrewProgressionProfile,
  createRecommendedProgressionProfile
} from "./constants.mjs";
import {
  banKey,
  buildCatalog,
  clearCatalogCache,
  entriesForProfile,
  isMechanicalItemExcluded,
  isNaturalSupplierEntry
} from "./catalog.mjs";
import { generateStock } from "./generator.mjs";
import { SupplierItemPicker } from "./item-picker.mjs";
import { HomebrewSupplierPicker } from "./homebrew-supplier-picker.mjs";
import { SupplierItemGroupPicker } from "./item-group-picker.mjs";
import {
  STOCK_RULE_MODES,
  createItemGroup,
  createStockRule,
  createSupplierProfileV2,
  itemGroupMatchesEntry,
  normalizeSupplierProfileV2,
  summarizeItemGroup
} from "./profile-v2.mjs";
import { MATERIALIZATION_RECIPE_REGISTRY } from "../../core/materialization/index.mjs";
import { getConfiguration, saveConfiguration } from "./settings.mjs";

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

function sourceDisplayLabel(source) {
  return `${source.label} — ${packageShortLabel(source.packageName)}`;
}

function themeIcon(themeId, customIcon) {
  if (themeId === "custom") return customIcon || "fa-solid fa-store";
  return SUPPLIER_THEMES.find(theme => theme.id === themeId)?.icon ?? "fa-solid fa-store";
}

function profilePresetLabel(profile) {
  if (!profile?.presetId) return "";
  const map = {
    blacksmith: "Blacksmith",
    alchemist: "Alchemist",
    herbalist: "Herbalist",
    hunter: "Hunter",
    butcher: "Butcher",
    "tavern-common": "TavernCommon",
    "tavern-dwarven": "TavernDwarven",
    "tavern-elven": "TavernElven",
    magic: "MagicAssortment",
    general: "GeneralTrade",
    stable: "StableLivestock",
    siege: "SiegeEngineer"
  };
  const key = map[profile.presetId];
  if (!key) return titleCase(profile.presetId);
  const localized = game.i18n.localize(`DND5E_SUPPLIER.Homebrew.${key}`);
  return localized === `DND5E_SUPPLIER.Homebrew.${key}` ? titleCase(profile.presetId) : localized;
}

function cloneProfileForDuplicate(source) {
  const copy = normalizeSupplierProfileV2(foundry.utils.deepClone(source));
  copy.id = foundry.utils.randomID();
  copy.name = game.i18n.format("DND5E_SUPPLIER.Config.SupplierCopyName", { name: source.name });
  copy.presetId = "";
  const remap = new Map();
  copy.itemGroups = (copy.itemGroups ?? []).map(group => {
    const oldId = group.id;
    const next = { ...group, id: foundry.utils.randomID() };
    remap.set(oldId, next.id);
    return next;
  });
  const mapIds = values => (values ?? []).map(value => remap.get(value) ?? value);
  copy.stockRules = (copy.stockRules ?? []).map(rule => ({
    ...rule,
    id: foundry.utils.randomID(),
    groupIds: mapIds(rule.groupIds),
    baseGroupIds: mapIds(rule.baseGroupIds),
    templateGroupIds: mapIds(rule.templateGroupIds)
  }));
  copy.bannedItems = (copy.bannedItems ?? []).map(item => ({ ...item, id: foundry.utils.randomID() }));
  return copy;
}

function ruleModeLabel(mode) {
  const keys = {
    guaranteed: "Guaranteed",
    random: "RandomOrganic",
    specialExisting: "ExistingSpecial",
    materialized: "MaterializedSpecial"
  };
  return game.i18n.localize(`DND5E_SUPPLIER.ProfileV2.${keys[mode] ?? "RandomOrganic"}`);
}

function scalingOptions(selected) {
  return [
    ["none", "NoScaling"],
    ["players", "PlusPlayers"],
    ["halfDown", "PlusHalfPlayers"],
    ["thirdDown", "PlusThirdPlayers"]
  ].map(([value, key]) => ({ value, label: game.i18n.localize(`DND5E_SUPPLIER.ProfileV2.${key}`), selected: selected === value }));
}

function quantityPresetOptions(selected) {
  return ["sparse", "normal", "abundant", "custom"].map(value => ({
    value,
    label: game.i18n.localize(`DND5E_SUPPLIER.ProfileV2.Quantity${titleCase(value).replaceAll(" ", "")}`),
    selected: selected === value
  }));
}

function ruleGroupOptions(profile, selectedIds = []) {
  const chosen = new Set(selectedIds ?? []);
  return (profile?.itemGroups ?? []).map(group => ({ id: group.id, name: group.name, checked: chosen.has(group.id) }));
}

export class SupplierConfigApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dnd5e-item-creator-supplier-configuration",
    classes: ["dnd5e-supplier", "dnd5e-supplier-config"],
    position: { width: 1160, height: 840 },
    window: {
      title: "DND5E_SUPPLIER.Config.Title",
      icon: "fa-solid fa-gears",
      resizable: true
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/supplier/config.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.draft = foundry.utils.deepClone(getConfiguration());
    this.draft.profiles = (this.draft.profiles ?? []).map(normalizeSupplierProfileV2);
    if (!this.draft.profiles.length) {
      this.draft.profiles.push(createSupplierProfileV2({
        name: game.i18n.localize("DND5E_SUPPLIER.Config.NewProfile"),
        sourceIds: (this.draft.sources ?? []).filter(source => source.enabled).map(source => source.id)
      }));
    }
    this.section = "sources";
    this.selectedProfileId = this.draft.profiles[0]?.id ?? null;
    this.profileSection = "stock";
    this.bannedSection = "manual";
    this.selectedProgressionProfileId = this.draft.activeProgressionProfileId ?? this.draft.progressionProfiles?.[0]?.id ?? null;
    this.validationPlayers = 5;
    this.validationLevel = 10;
    this.profilePreview = null;
    this.profilePreviewError = "";
    this.viewState = { scroll: {}, focus: null, openRules: [], knownRules: [], captured: false };
  }

  async _prepareContext() {
    const packs = game.packs
      .filter(pack => pack.documentName === "Item")
      .map(pack => ({
        id: pack.collection,
        label: pack.metadata.label,
        packageName: pack.metadata.packageName,
        displayLabel: sourceDisplayLabel({ label: pack.metadata.label, packageName: pack.metadata.packageName })
      }));

    const sourceMap = new Map((this.draft.sources ?? []).map(source => [source.id, source]));
    const sources = packs.map((pack, index) => {
      const saved = sourceMap.get(pack.id) ?? { id: pack.id, enabled: false, priority: 10000 + index };
      return { ...pack, ...saved };
    }).sort((a, b) => Number(a.priority) - Number(b.priority));
    this.draft.sources = sources.map((source, index) => ({ id: source.id, enabled: Boolean(source.enabled), priority: index }));

    const selectedIndex = Math.max(0, this.draft.profiles.findIndex(profile => profile.id === this.selectedProfileId));
    const selectedProfile = this.draft.profiles[selectedIndex] ?? null;
    const globallyEnabled = sources.filter(source => source.enabled);

    let catalog = { entries: [], familyGroups: new Map(), grouped: new Map(), rawEntries: [] };
    let profileEntries = [];
    try {
      catalog = await buildCatalog({ configurationOverride: this.draft });
      // Profile editing always previews the raw source candidates. Firearm
      // normalization is applied by the generator so a firearm-focused group
      // remains visible/editable and can transparently resolve to medieval
      // replacements when the profile toggle is enabled.
      profileEntries = selectedProfile
        ? entriesForProfile(catalog, selectedProfile, this.draft).filter(entry => !isNaturalSupplierEntry(entry))
        : [];
    } catch (error) {
      console.warn(`${MODULE_ID} | Configuration pool preview unavailable`, error);
    }

    const itemGroups = (selectedProfile?.itemGroups ?? []).map((group, index) => {
      const count = profileEntries.filter(entry => itemGroupMatchesEntry(group, entry)).length;
      return {
        ...group,
        index,
        path: `profiles.${selectedIndex}.itemGroups.${index}`,
        summary: summarizeItemGroup(group),
        candidateCount: count,
        explicitMode: group.selectionMode === "explicit",
        dynamicMode: group.selectionMode !== "explicit"
      };
    });

    const materializationRecipeOptions = [
      { id: "", name: game.i18n.localize("DND5E_SUPPLIER.ProfileV2.AutomaticRecipe") },
      ...MATERIALIZATION_RECIPE_REGISTRY
        .filter(recipe => recipe.id === "enchanted-ammunition" || recipe.mode !== "pass-through")
        .map(recipe => ({ id: recipe.id, name: recipe.name ?? titleCase(recipe.id) }))
    ];

    const stockRules = (selectedProfile?.stockRules ?? []).map((rule, index) => ({
      ...rule,
      index,
      path: `profiles.${selectedIndex}.stockRules.${index}`,
      isGuaranteed: rule.mode === "guaranteed",
      isRandom: rule.mode === "random",
      isSpecialExisting: rule.mode === "specialExisting",
      isMaterialized: rule.mode === "materialized",
      coverageAll: rule.coverage !== "pick",
      coveragePick: rule.coverage === "pick",
      showPickLimits: rule.mode !== "guaranteed" || rule.coverage === "pick",
      quantityCustom: rule.quantityPreset === "custom",
      modeLabel: ruleModeLabel(rule.mode),
      modeOptions: STOCK_RULE_MODES.map(mode => ({ value: mode, label: ruleModeLabel(mode), selected: mode === rule.mode })),
      groupOptions: ruleGroupOptions(selectedProfile, rule.groupIds),
      baseGroupOptions: ruleGroupOptions(selectedProfile, rule.baseGroupIds),
      templateGroupOptions: ruleGroupOptions(selectedProfile, rule.templateGroupIds),
      scalingOptions: scalingOptions(rule.scaling),
      varietyScalingOptions: scalingOptions(rule.varietyScaling),
      quantityPresetOptions: quantityPresetOptions(rule.quantityPreset),
      materializationRecipeOptions: materializationRecipeOptions.map(option => ({ ...option, selected: option.id === rule.materializationRecipe }))
    }));

    const progressionProfiles = this.draft.progressionProfiles ?? [];
    const selectedProgressionIndex = Math.max(0, progressionProfiles.findIndex(profile => profile.id === this.selectedProgressionProfileId));
    const selectedProgressionProfile = progressionProfiles[selectedProgressionIndex] ?? null;
    if (selectedProgressionProfile && selectedProgressionProfile.id !== this.selectedProgressionProfileId) this.selectedProgressionProfileId = selectedProgressionProfile.id;

    const levelBands = (selectedProgressionProfile?.levelBands ?? []).map((band, index) => ({
      ...band,
      index,
      rarityOptions: RARITIES.map(rarity => ({ ...rarity, localized: game.i18n.localize(rarity.label), checked: (band.rarities ?? []).includes(rarity.value) }))
    }));
    const enchantmentBands = (selectedProgressionProfile?.enchantmentBands ?? []).map((band, index) => ({
      ...band,
      index,
      weight0: Number(band.weights?.[0] ?? band.weights?.["0"] ?? 0),
      weight1: Number(band.weights?.[1] ?? band.weights?.["1"] ?? 0),
      weight2: Number(band.weights?.[2] ?? band.weights?.["2"] ?? 0),
      weight3: Number(band.weights?.[3] ?? band.weights?.["3"] ?? 0)
    }));

    const currentTheme = SUPPLIER_THEMES.find(theme => theme.id === selectedProfile?.theme) ?? SUPPLIER_THEMES.at(-1);
    const selectedSourceIds = new Set(selectedProfile?.sourceIds ?? []);
    const mechanicalEntries = (catalog.rawEntries ?? [])
      .filter(entry => entry.isMechanical === true)
      .filter(entry => !selectedSourceIds.size || selectedSourceIds.has(entry.packId))
      .sort((a, b) => a.name.localeCompare(b.name) || sourceDisplayLabel({ label: a.packLabel, packageName: a.packageName }).localeCompare(sourceDisplayLabel({ label: b.packLabel, packageName: b.packageName })));
    const mechanicalRows = mechanicalEntries.map(entry => {
      const override = (selectedProfile?.mechanicalItemOverrides ?? []).find(item => item.uuid === entry.uuid);
      const excluded = selectedProfile ? isMechanicalItemExcluded(entry, selectedProfile, this.draft) : this.draft.excludeMechanicalItems !== false;
      return {
        ...entry,
        excluded,
        inherited: !override,
        sourceLabel: sourceDisplayLabel({ label: entry.packLabel, packageName: entry.packageName }),
        reasonLabel: game.i18n.localize(`DND5E_SUPPLIER.MechanicalReason.${entry.mechanicalReason || "generic"}`),
        normalizedName: String(entry.name ?? "").toLowerCase(),
        normalizedType: String(entry.type ?? "").toLowerCase(),
        normalizedSource: String(entry.packId ?? "").toLowerCase(),
        policyLabel: game.i18n.localize(excluded ? "DND5E_SUPPLIER.Config.MechanicalExcluded" : "DND5E_SUPPLIER.Config.MechanicalAllowed"),
        inheritanceLabel: game.i18n.localize(override ? "DND5E_SUPPLIER.Config.ProfileOverride" : "DND5E_SUPPLIER.Config.GlobalPolicy")
      };
    });
    const mechanicalExcludedCount = mechanicalRows.filter(entry => entry.excluded).length;
    const manualBannedCount = selectedProfile?.bannedItems?.length ?? 0;
    const activeWorldProgression = progressionProfiles.find(profile => profile.id === this.draft.activeProgressionProfileId) ?? progressionProfiles[0];
    const activeWorldProgressionName = activeWorldProgression?.recommended
      ? game.i18n.localize("DND5E_SUPPLIER.Config.RecommendedProgressionName")
      : activeWorldProgression?.homebrew
        ? game.i18n.localize("DND5E_SUPPLIER.Config.HomebrewProgressionName")
        : activeWorldProgression?.name ?? "";

    const previewLines = (this.profilePreview?.preview ?? []).map(line => ({
      ...line,
      quantity: Math.max(1, Number(line.quantity ?? 1)),
      rarityLabel: titleCase(line.rarity || "none")
    }));

    return {
      section: this.section,
      isSources: this.section === "sources",
      isProfiles: this.section === "profiles",
      isProgression: this.section === "progression",
      isOutput: this.section === "output",
      profileStockTab: this.profileSection === "stock",
      profileBannedTab: this.profileSection === "banned",
      bannedManualTab: this.bannedSection === "manual",
      bannedMechanicalTab: this.bannedSection === "mechanical",
      excludeMechanicalItems: this.draft.excludeMechanicalItems !== false,
      globalMechanicalCount: (catalog.rawEntries ?? []).filter(entry => entry.isMechanical === true).length,
      sources: sources.map((source, index) => ({ ...source, displayLabel: source.displayLabel || sourceDisplayLabel(source), index })),
      profiles: this.draft.profiles.map(profile => ({
        ...profile,
        icon: themeIcon(profile.theme, profile.customIcon),
        selected: profile.id === this.selectedProfileId,
        themeClass: `theme-${profile.theme || "custom"}`
      })),
      selectedProfile: selectedProfile ? {
        ...selectedProfile,
        icon: themeIcon(selectedProfile.theme, selectedProfile.customIcon),
        isCustomTheme: selectedProfile.theme === "custom",
        themeClass: `theme-${selectedProfile.theme || "custom"}`
      } : null,
      selectedProfileIndex: selectedIndex,
      selectedProfilePresetLabel: profilePresetLabel(selectedProfile),
      selectedProfileHasPreset: Boolean(selectedProfile?.presetId),
      currentTheme,
      themeOptions: SUPPLIER_THEMES.map(theme => ({
        ...theme,
        localized: game.i18n.localize(theme.label),
        selected: theme.id === selectedProfile?.theme,
        themeClass: `theme-${theme.id}`
      })),
      profileSourceOptions: globallyEnabled.map(source => ({ ...source, displayLabel: source.displayLabel || sourceDisplayLabel(source), checked: selectedProfile?.sourceIds?.includes(source.id) })),
      itemGroups,
      stockRules,
      itemGroupCount: itemGroups.length,
      stockRuleCount: stockRules.length,
      scrollStockEnabled: selectedProfile?.scrollStock?.enabled === true,
      scrollScalingOptions: scalingOptions(selectedProfile?.scrollStock?.scaling ?? "halfDown"),
      validationPlayers: this.validationPlayers,
      validationLevel: this.validationLevel,
      profilePreview: this.profilePreview,
      profilePreviewLines: previewLines,
      profilePreviewError: this.profilePreviewError,
      levelBands,
      enchantmentBands,
      progressionProfiles: progressionProfiles.map(profile => ({
        ...profile,
        selected: profile.id === selectedProgressionProfile?.id,
        active: profile.id === this.draft.activeProgressionProfileId,
        displayName: profile.recommended
          ? game.i18n.localize("DND5E_SUPPLIER.Config.RecommendedProgressionName")
          : profile.homebrew
            ? game.i18n.localize("DND5E_SUPPLIER.Config.HomebrewProgressionName")
            : profile.name
      })),
      profileAccessOptions: ["1", "2", "3", "4"].map(value => ({
        value,
        label: game.i18n.localize(`DND5E_SUPPLIER.Homebrew.Access${value}`),
        selected: String(selectedProfile?.homebrewAccessLevel ?? "2") === value
      })),
      profileProgressionOptions: [
        { id: "world", displayName: game.i18n.format("DND5E_SUPPLIER.Config.WorldDefaultProgression", { name: activeWorldProgressionName }), selected: !selectedProfile?.progressionProfileId || selectedProfile?.progressionProfileId === "world" },
        ...progressionProfiles.map(profile => ({
          id: profile.id,
          displayName: profile.recommended
            ? game.i18n.localize("DND5E_SUPPLIER.Config.RecommendedProgressionName")
            : profile.homebrew
              ? game.i18n.localize("DND5E_SUPPLIER.Config.HomebrewProgressionName")
              : profile.name,
          selected: selectedProfile?.progressionProfileId === profile.id
        }))
      ],
      selectedProfileAccessLabel: selectedProfile?.homebrewAccessLevel
        ? game.i18n.localize(`DND5E_SUPPLIER.Homebrew.Access${selectedProfile.homebrewAccessLevel}`)
        : game.i18n.localize("DND5E_SUPPLIER.Homebrew.AccessCustom"),
      selectedProfileAccessClass: ["1", "2", "3", "4"].includes(String(selectedProfile?.homebrewAccessLevel)) ? `access-${selectedProfile.homebrewAccessLevel}` : "access-custom",
      selectedProfileAccessHint: selectedProfile?.homebrewAccessLevel
        ? game.i18n.localize(`DND5E_SUPPLIER.Homebrew.Access${selectedProfile.homebrewAccessLevel}Hint`)
        : game.i18n.localize("DND5E_SUPPLIER.Homebrew.AccessCustomHint"),
      selectedProgressionProfile: selectedProgressionProfile ? {
        ...selectedProgressionProfile,
        locked: Boolean(selectedProgressionProfile.builtIn),
        displayName: selectedProgressionProfile.recommended
          ? game.i18n.localize("DND5E_SUPPLIER.Config.RecommendedProgressionName")
          : selectedProgressionProfile.homebrew
            ? game.i18n.localize("DND5E_SUPPLIER.Config.HomebrewProgressionName")
            : selectedProgressionProfile.name
      } : null,
      selectedProgressionIndex,
      progressionLocked: Boolean(selectedProgressionProfile?.builtIn),
      canDeleteProgressionProfile: progressionProfiles.length > 1 && !selectedProgressionProfile?.builtIn,
      useCorePricing: selectedProgressionProfile?.useCorePricing !== false,
      rarities: RARITIES.map(rarity => ({
        ...rarity,
        localized: game.i18n.localize(rarity.label),
        price: selectedProgressionProfile?.priceFallbacks?.[rarity.value] ?? (rarity.value === "artifact" ? 0 : 1),
        allowsZero: rarity.value === "artifact"
      })),
      qualityPrices: [1, 2, 3].map(bonus => ({ bonus, price: selectedProgressionProfile?.qualityPriceAdditions?.[bonus] ?? 0 })),
      profileBannedItems: (selectedProfile?.bannedItems ?? []).map(item => {
        const equivalentCount = (catalog.rawEntries ?? []).filter(entry => {
          if (selectedProfile?.sourceIds?.length && !selectedProfile.sourceIds.includes(entry.packId)) return false;
          return banKey(entry) === item.key;
        }).length;
        return {
          ...item,
          scopeLabel: game.i18n.localize(item.allSources ? "DND5E_SUPPLIER.Config.AllEquivalentSources" : "DND5E_SUPPLIER.Config.OnlyThisSource"),
          sourceLabel: item.packLabel ? `${item.packLabel} — ${packageShortLabel(item.packageName)}` : game.i18n.localize("DND5E_SUPPLIER.Config.AllSources"),
          normalizedName: String(item.name ?? "").toLowerCase(),
          normalizedType: String(item.type ?? "").toLowerCase(),
          normalizedSource: String(item.packId ?? "").toLowerCase(),
          scopeValue: item.allSources ? "all" : "source",
          equivalentNote: item.allSources
            ? game.i18n.format("DND5E_SUPPLIER.Config.EquivalentVersionsBanned", { count: Math.max(1, equivalentCount) })
            : game.i18n.format("DND5E_SUPPLIER.Config.EquivalentVersionsRemain", { count: Math.max(0, equivalentCount - 1) })
        };
      }),
      bannedTypeOptions: [...new Set((selectedProfile?.bannedItems ?? []).map(item => item.type).filter(Boolean))].sort().map(value => ({ value, label: titleCase(value) })),
      bannedSourceOptions: [...new Map((selectedProfile?.bannedItems ?? []).filter(item => item.packId).map(item => [item.packId, `${item.packLabel} — ${packageShortLabel(item.packageName)}`])).entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })),
      profileManualBannedCount: manualBannedCount,
      profileMechanicalItems: mechanicalRows,
      profileMechanicalCount: mechanicalRows.length,
      profileMechanicalExcludedCount: mechanicalExcludedCount,
      mechanicalTypeOptions: [...new Set(mechanicalRows.map(item => item.type).filter(Boolean))].sort().map(value => ({ value, label: titleCase(value) })),
      mechanicalSourceOptions: [...new Map(mechanicalRows.map(item => [item.packId, item.sourceLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })),
      profileBannedCount: manualBannedCount + mechanicalExcludedCount,
      folderNameTemplate: this.draft.folderNameTemplate
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    root.querySelectorAll("[data-section]").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      this.section = button.dataset.section;
      this.#renderWithState({ resetContent: true });
    }));

    root.querySelectorAll("[data-profile-id]").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      this.selectedProfileId = button.dataset.profileId;
      this.profileSection = "stock";
      this.bannedSection = "manual";
      this.profilePreview = null;
      this.profilePreviewError = "";
      this.#renderWithState();
    }));

    root.querySelectorAll("[data-rerender]").forEach(input => input.addEventListener("change", () => {
      this.#syncForm();
      this.profilePreview = null;
      this.profilePreviewError = "";
      this.#renderWithState();
    }));

    root.querySelectorAll("[data-theme-id]").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProfile();
      if (!profile) return;
      profile.theme = button.dataset.themeId;
      profile.icon = themeIcon(profile.theme, profile.customIcon);
      this.#renderWithState();
    }));

    root.querySelector("[data-action='add-profile']")?.addEventListener("click", () => {
      this.#syncForm();
      const sourceIds = this.draft.sources.filter(source => source.enabled).map(source => source.id);
      new HomebrewSupplierPicker({
        sourceIds,
        onCreate: async profile => {
          this.draft.profiles.push(normalizeSupplierProfileV2(profile));
          this.selectedProfileId = profile.id;
          this.section = "profiles";
          this.profileSection = "stock";
          this.bannedSection = "manual";
          this.profilePreview = null;
          this.profilePreviewError = "";
          this.#renderWithState({ resetContent: true });
        }
      }).render(true);
    });

    root.querySelector("[data-action='duplicate-profile']")?.addEventListener("click", () => {
      this.#syncForm();
      const source = this.#selectedProfile();
      if (!source) return;
      const profile = cloneProfileForDuplicate(source);
      this.draft.profiles.push(profile);
      this.selectedProfileId = profile.id;
      this.profilePreview = null;
      this.profilePreviewError = "";
      this.#renderWithState({ resetContent: true });
    });

    root.querySelector("[data-action='delete-profile']")?.addEventListener("click", () => {
      this.#syncForm();
      if (this.draft.profiles.length <= 1) {
        ui.notifications.warn(game.i18n.localize("DND5E_SUPPLIER.Config.MustKeepProfile"));
        return;
      }
      const index = this.draft.profiles.findIndex(profile => profile.id === this.selectedProfileId);
      if (index >= 0) this.draft.profiles.splice(index, 1);
      this.selectedProfileId = this.draft.profiles[0]?.id ?? null;
      this.profilePreview = null;
      this.profilePreviewError = "";
      this.#renderWithState({ resetContent: true });
    });

    root.querySelector("[data-action='add-item-group']")?.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProfile();
      if (!profile) return;
      const group = createItemGroup({ name: game.i18n.localize("DND5E_SUPPLIER.ProfileV2.NewItemGroup") });
      this.#openItemGroupPicker(group, null);
    });

    root.querySelectorAll("[data-action='edit-item-group']").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProfile();
      const index = Number(button.dataset.index);
      const group = profile?.itemGroups?.[index];
      if (group) this.#openItemGroupPicker(group, index);
    }));

    root.querySelectorAll("[data-action='remove-item-group']").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProfile();
      const index = Number(button.dataset.index);
      const id = profile?.itemGroups?.[index]?.id;
      if (!profile || !id) return;
      profile.itemGroups.splice(index, 1);
      for (const rule of profile.stockRules ?? []) {
        rule.groupIds = (rule.groupIds ?? []).filter(value => value !== id);
        rule.baseGroupIds = (rule.baseGroupIds ?? []).filter(value => value !== id);
        rule.templateGroupIds = (rule.templateGroupIds ?? []).filter(value => value !== id);
      }
      this.profilePreview = null;
      this.#renderWithState();
    }));

    root.querySelectorAll("[data-action='add-stock-rule']").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProfile();
      if (!profile) return;
      const mode = button.dataset.mode || "random";
      const rule = createStockRule(mode);

      // Guaranteed Stock is intentionally a set-oriented workflow. The rule is
      // only committed after its first Item Set is saved, so cancelling the
      // picker cannot leave a confusing empty Guaranteed rule behind.
      if (mode === "guaranteed") {
        const group = createItemGroup({
          name: `${rule.name} — ${game.i18n.localize("DND5E_SUPPLIER.ProfileV2.SourceGroupSuffix")}`
        });
        new SupplierItemGroupPicker({
          profile: foundry.utils.deepClone(profile),
          group: foundry.utils.deepClone(group),
          configuration: foundry.utils.deepClone(this.draft),
          onSave: saved => {
            profile.itemGroups.push(saved);
            rule.groupIds = [saved.id];
            profile.stockRules.push(rule);
            this.profilePreview = null;
            this.profilePreviewError = "";
            this.#renderWithState();
          }
        }).render(true);
        return;
      }

      profile.stockRules.push(rule);
      this.profilePreview = null;
      this.#renderWithState();
    }));

    root.querySelectorAll("[data-action='create-rule-group']").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProfile();
      if (!profile) return;
      const ruleId = String(button.dataset.ruleId ?? "");
      const target = String(button.dataset.target ?? "groupIds");
      if (!["groupIds", "baseGroupIds", "templateGroupIds"].includes(target)) return;
      const rule = (profile.stockRules ?? []).find(entry => entry.id === ruleId);
      if (!rule) return;
      const suffix = target === "baseGroupIds"
        ? game.i18n.localize("DND5E_SUPPLIER.ProfileV2.BaseGroupSuffix")
        : target === "templateGroupIds"
          ? game.i18n.localize("DND5E_SUPPLIER.ProfileV2.TemplateGroupSuffix")
          : game.i18n.localize("DND5E_SUPPLIER.ProfileV2.SourceGroupSuffix");
      const group = createItemGroup({ name: `${rule.name || game.i18n.localize("DND5E_SUPPLIER.ProfileV2.NewItemGroup")} — ${suffix}` });
      this.#openItemGroupPicker(group, null, { ruleId, target });
    }));

    root.querySelectorAll("[data-action='remove-stock-rule']").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProfile();
      if (!profile) return;
      profile.stockRules.splice(Number(button.dataset.index), 1);
      this.profilePreview = null;
      this.#renderWithState();
    }));

    root.querySelector("[data-action='generate-profile-preview']")?.addEventListener("click", async () => {
      this.#syncForm();
      const profile = foundry.utils.deepClone(this.#selectedProfile());
      if (!profile) return;
      const button = root.querySelector("[data-action='generate-profile-preview']");
      if (button) button.disabled = true;
      try {
        this.profilePreview = await generateStock({
          profile,
          level: this.validationLevel,
          players: this.validationPlayers,
          logDiagnostics: false,
          configurationOverride: foundry.utils.deepClone(this.draft)
        });
        this.profilePreviewError = "";
      } catch (error) {
        console.error(`${MODULE_ID} | Supplier profile preview failed`, error);
        this.profilePreview = null;
        this.profilePreviewError = error.message;
      }
      this.#renderWithState();
    });

    this.#activateSourceDragAndDrop(root);

    root.querySelector("[data-action='select-progression-profile']")?.addEventListener("change", event => {
      this.#syncForm();
      this.selectedProgressionProfileId = event.currentTarget.value;
      this.draft.activeProgressionProfileId = this.selectedProgressionProfileId;
      this.#renderWithState();
    });

    root.querySelector("[data-action='new-progression-profile']")?.addEventListener("click", () => {
      this.#syncForm();
      const recommended = createRecommendedProgressionProfile();
      const count = (this.draft.progressionProfiles ?? []).filter(profile => !profile.recommended).length + 1;
      const profile = createCustomProgressionProfile(recommended, game.i18n.format("DND5E_SUPPLIER.Config.CustomProgressionName", { number: count }));
      this.draft.progressionProfiles.push(profile);
      this.selectedProgressionProfileId = profile.id;
      this.draft.activeProgressionProfileId = profile.id;
      this.#renderWithState({ resetContent: true });
    });

    root.querySelector("[data-action='duplicate-progression-profile']")?.addEventListener("click", () => {
      this.#syncForm();
      const source = this.#selectedProgressionProfile();
      if (!source) return;
      const profile = createCustomProgressionProfile(source, game.i18n.format("DND5E_SUPPLIER.Config.ProgressionCopyName", { name: source.name }));
      this.draft.progressionProfiles.push(profile);
      this.selectedProgressionProfileId = profile.id;
      this.draft.activeProgressionProfileId = profile.id;
      this.#renderWithState({ resetContent: true });
    });

    root.querySelector("[data-action='restore-progression-profile']")?.addEventListener("click", () => {
      this.#syncForm();
      const target = this.#selectedProgressionProfile();
      if (!target) return;
      const baseline = target.homebrew ? createHammerHomebrewProgressionProfile() : createRecommendedProgressionProfile();
      const keepName = target.builtIn ? baseline.name : target.name;
      target.name = keepName;
      target.levelBands = foundry.utils.deepClone(baseline.levelBands);
      target.enchantmentBands = foundry.utils.deepClone(baseline.enchantmentBands);
      target.priceFallbacks = foundry.utils.deepClone(baseline.priceFallbacks);
      target.qualityPriceAdditions = foundry.utils.deepClone(baseline.qualityPriceAdditions);
      target.useCorePricing = baseline.useCorePricing !== false;
      this.#renderWithState();
    });

    root.querySelector("[data-action='delete-progression-profile']")?.addEventListener("click", () => {
      this.#syncForm();
      if ((this.draft.progressionProfiles ?? []).length <= 1) return;
      const selected = this.#selectedProgressionProfile();
      if (selected?.builtIn) return;
      const removedId = this.selectedProgressionProfileId;
      const index = this.draft.progressionProfiles.findIndex(profile => profile.id === removedId);
      if (index >= 0) this.draft.progressionProfiles.splice(index, 1);
      for (const supplierProfile of this.draft.profiles ?? []) if (supplierProfile.progressionProfileId === removedId) supplierProfile.progressionProfileId = "world";
      const next = this.draft.progressionProfiles[Math.max(0, index - 1)] ?? this.draft.progressionProfiles[0];
      this.selectedProgressionProfileId = next?.id ?? null;
      this.draft.activeProgressionProfileId = this.selectedProgressionProfileId;
      this.#renderWithState({ resetContent: true });
    });

    root.querySelector("[data-action='add-band']")?.addEventListener("click", () => {
      this.#syncForm();
      this.#selectedProgressionProfile()?.levelBands.push({ id: foundry.utils.randomID(), min: 1, max: 20, rarities: ["none", "common"], maxSpellLevel: 1 });
      this.#renderWithState();
    });
    root.querySelectorAll("[data-action='remove-band']").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      this.#selectedProgressionProfile()?.levelBands.splice(Number(button.dataset.index), 1);
      this.#renderWithState();
    }));

    root.querySelectorAll("[data-profile-section]").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      this.profileSection = button.dataset.profileSection;
      if (this.profileSection === "banned" && !["manual", "mechanical"].includes(this.bannedSection)) this.bannedSection = "manual";
      this.#renderWithState({ resetContent: true });
    }));
    root.querySelectorAll("[data-banned-section]").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      this.bannedSection = button.dataset.bannedSection;
      this.#renderWithState({ resetContent: true });
    }));

    root.querySelectorAll("[data-source-toggle]").forEach(input => input.addEventListener("change", () => {
      const index = Number(input.dataset.sourceToggle);
      if (this.draft.sources[index]) this.draft.sources[index].enabled = input.checked;
    }));

    root.querySelector("[data-action='add-banned-items']")?.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProfile();
      if (!profile) return;
      new SupplierItemPicker({
        profile: foundry.utils.deepClone(profile),
        multiple: true,
        includeBanned: true,
        rawSourceDocuments: true,
        banMode: true,
        title: game.i18n.localize("DND5E_SUPPLIER.Config.BannedPickerTitle"),
        configuration: foundry.utils.deepClone(this.draft),
        onSelect: selected => {
          profile.bannedItems ??= [];
          for (const item of selected) {
            if (item.allSources) {
              profile.bannedItems = profile.bannedItems.filter(existing => existing.key !== item.key);
              profile.bannedItems.push({ ...item, id: foundry.utils.randomID(), allSources: true });
              continue;
            }
            if (profile.bannedItems.some(existing => existing.allSources && existing.key === item.key)) continue;
            if (profile.bannedItems.some(existing => existing.uuid === item.uuid)) continue;
            profile.bannedItems.push({ ...item, id: foundry.utils.randomID(), allSources: false });
          }
          this.#renderWithState();
        }
      }).render(true);
    });

    root.querySelectorAll("[data-action='remove-banned-item']").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProfile();
      if (!profile) return;
      profile.bannedItems = (profile.bannedItems ?? []).filter(item => item.id !== button.dataset.banId);
      this.#renderWithState();
    }));

    root.querySelector("[data-action='remove-selected-bans']")?.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProfile();
      const selectedIds = new Set([...root.querySelectorAll("[data-ban-select]:checked")].map(input => input.value));
      if (!selectedIds.size || !profile) return;
      profile.bannedItems = (profile.bannedItems ?? []).filter(item => !selectedIds.has(item.id));
      this.#renderWithState();
    });

    const banSearch = root.querySelector("[data-ban-filter='search']");
    const banType = root.querySelector("[data-ban-filter='type']");
    const banSource = root.querySelector("[data-ban-filter='source']");
    const banScope = root.querySelector("[data-ban-filter='scope']");
    const applyBanFilters = () => {
      const query = String(banSearch?.value ?? "").trim().toLowerCase();
      const type = String(banType?.value ?? "").toLowerCase();
      const source = String(banSource?.value ?? "").toLowerCase();
      const scope = String(banScope?.value ?? "");
      let visible = 0;
      for (const row of root.querySelectorAll("[data-banned-row]")) {
        row.hidden = Boolean((query && !row.dataset.name.includes(query)) || (type && row.dataset.type !== type) || (source && row.dataset.source !== source) || (scope && row.dataset.scope !== scope));
        if (!row.hidden) visible += 1;
      }
      const counter = root.querySelector("[data-visible-bans]");
      if (counter) counter.textContent = String(visible);
    };
    banSearch?.addEventListener("input", applyBanFilters);
    banType?.addEventListener("change", applyBanFilters);
    banSource?.addEventListener("change", applyBanFilters);
    banScope?.addEventListener("change", applyBanFilters);
    applyBanFilters();

    const setMechanicalOverride = (profile, uuid, excluded) => {
      profile.mechanicalItemOverrides ??= [];
      const defaultExcluded = this.draft.excludeMechanicalItems !== false;
      profile.mechanicalItemOverrides = profile.mechanicalItemOverrides.filter(item => item.uuid !== uuid);
      if (excluded !== defaultExcluded) profile.mechanicalItemOverrides.push({ uuid, excluded });
    };
    root.querySelectorAll("[data-mechanical-toggle]").forEach(input => input.addEventListener("change", event => {
      event.stopPropagation();
      this.#syncForm();
      const profile = this.#selectedProfile();
      if (!profile) return;
      setMechanicalOverride(profile, input.dataset.mechanicalToggle, input.checked);
      this.#renderWithState();
    }));
    root.querySelector("[data-action='exclude-all-mechanical']")?.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProfile();
      if (!profile) return;
      for (const row of root.querySelectorAll("[data-mechanical-row]")) setMechanicalOverride(profile, row.dataset.uuid, true);
      this.#renderWithState();
    });
    root.querySelector("[data-action='allow-all-mechanical']")?.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProfile();
      if (!profile) return;
      for (const row of root.querySelectorAll("[data-mechanical-row]")) setMechanicalOverride(profile, row.dataset.uuid, false);
      this.#renderWithState();
    });

    const mechanicalSearch = root.querySelector("[data-mechanical-filter='search']");
    const mechanicalType = root.querySelector("[data-mechanical-filter='type']");
    const mechanicalSource = root.querySelector("[data-mechanical-filter='source']");
    const mechanicalState = root.querySelector("[data-mechanical-filter='state']");
    const applyMechanicalFilters = () => {
      const query = String(mechanicalSearch?.value ?? "").trim().toLowerCase();
      const type = String(mechanicalType?.value ?? "").toLowerCase();
      const source = String(mechanicalSource?.value ?? "").toLowerCase();
      const state = String(mechanicalState?.value ?? "");
      let visible = 0;
      for (const row of root.querySelectorAll("[data-mechanical-row]")) {
        row.hidden = Boolean((query && !row.dataset.name.includes(query)) || (type && row.dataset.type !== type) || (source && row.dataset.source !== source) || (state && row.dataset.state !== state));
        if (!row.hidden) visible += 1;
      }
      const counter = root.querySelector("[data-visible-mechanical]");
      if (counter) counter.textContent = String(visible);
    };
    mechanicalSearch?.addEventListener("input", applyMechanicalFilters);
    mechanicalType?.addEventListener("change", applyMechanicalFilters);
    mechanicalSource?.addEventListener("change", applyMechanicalFilters);
    mechanicalState?.addEventListener("change", applyMechanicalFilters);
    applyMechanicalFilters();

    root.querySelectorAll("[data-action='open-item-document']").forEach(button => button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const document = await fromUuid(button.dataset.uuid);
      document?.sheet?.render(true);
    }));

    root.querySelector("[data-action='add-quality-band']")?.addEventListener("click", () => {
      this.#syncForm();
      this.#selectedProgressionProfile()?.enchantmentBands.push({ id: foundry.utils.randomID(), min: 1, max: 20, weights: { 0: 100, 1: 0, 2: 0, 3: 0 } });
      this.#renderWithState();
    });
    root.querySelectorAll("[data-action='remove-quality-band']").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      this.#selectedProgressionProfile()?.enchantmentBands.splice(Number(button.dataset.index), 1);
      this.#renderWithState();
    }));

    root.querySelector("[data-action='save']")?.addEventListener("click", async () => {
      this.#syncForm();
      this.draft.sources.forEach((source, index) => { source.priority = index; });
      this.draft.activeProgressionProfileId = this.selectedProgressionProfileId ?? this.draft.activeProgressionProfileId;
      await saveConfiguration(this.draft);
      clearCatalogCache();
      ui.notifications.info(game.i18n.localize("DND5E_SUPPLIER.Config.Saved"));
      this.#renderWithState();
    });

    this.#restoreViewState();
  }

  #openItemGroupPicker(group, index, attach = null) {
    const profile = this.#selectedProfile();
    if (!profile) return;
    new SupplierItemGroupPicker({
      profile: foundry.utils.deepClone(profile),
      group: foundry.utils.deepClone(group),
      configuration: foundry.utils.deepClone(this.draft),
      onSave: saved => {
        if (index === null) profile.itemGroups.push(saved);
        else profile.itemGroups[index] = saved;

        if (attach?.ruleId && attach?.target) {
          const rule = (profile.stockRules ?? []).find(entry => entry.id === attach.ruleId);
          if (rule && ["groupIds", "baseGroupIds", "templateGroupIds"].includes(attach.target)) {
            const ids = new Set(rule[attach.target] ?? []);
            ids.add(saved.id);
            rule[attach.target] = [...ids];
          }
        }

        this.profilePreview = null;
        this.profilePreviewError = "";
        this.#renderWithState();
      }
    }).render(true);
  }

  #activateSourceDragAndDrop(root) {
    const list = root.querySelector("[data-source-list]");
    if (!list) return;
    let draggedIndex = null;
    for (const row of list.querySelectorAll("[data-source-row]")) {
      const handle = row.querySelector("[data-source-drag-handle]");
      if (!handle) continue;
      handle.addEventListener("pointerdown", () => { row.draggable = true; });
      handle.addEventListener("pointerup", () => { row.draggable = false; });
      row.addEventListener("dragstart", event => {
        // The row only becomes draggable after the grip is pressed, so reaching
        // dragstart here is itself the guard that prevents accidental row drags.
        this.#syncForm();
        draggedIndex = Number(row.dataset.sourceRow);
        row.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(draggedIndex));
      });
      row.addEventListener("dragend", () => {
        row.draggable = false;
        draggedIndex = null;
        row.classList.remove("dragging");
        for (const item of list.querySelectorAll("[data-source-row]")) item.classList.remove("drag-over-before", "drag-over-after");
      });
      row.addEventListener("dragover", event => {
        if (draggedIndex === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = row.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        row.classList.toggle("drag-over-before", !after);
        row.classList.toggle("drag-over-after", after);
        const listRect = list.getBoundingClientRect();
        if (event.clientY < listRect.top + 36) list.scrollTop -= 18;
        else if (event.clientY > listRect.bottom - 36) list.scrollTop += 18;
      });
      row.addEventListener("dragleave", () => row.classList.remove("drag-over-before", "drag-over-after"));
      row.addEventListener("drop", event => {
        if (draggedIndex === null) return;
        event.preventDefault();
        const targetIndex = Number(row.dataset.sourceRow);
        const rect = row.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        const [moved] = this.draft.sources.splice(draggedIndex, 1);
        let insertIndex = targetIndex;
        if (draggedIndex < targetIndex) insertIndex -= 1;
        if (after) insertIndex += 1;
        insertIndex = Math.max(0, Math.min(this.draft.sources.length, insertIndex));
        this.draft.sources.splice(insertIndex, 0, moved);
        this.draft.sources.forEach((source, index) => { source.priority = index; });
        this.#renderWithState();
      });
    }
  }

  #captureViewState() {
    const root = this.element;
    if (!root) return;
    const scroll = {};
    for (const element of root.querySelectorAll("[data-scroll-key]")) scroll[element.dataset.scrollKey] = { top: element.scrollTop, left: element.scrollLeft };
    let focus = null;
    const active = root.ownerDocument?.activeElement;
    if (active && root.contains(active)) {
      focus = {
        path: active.dataset?.path ?? "",
        arrayPath: active.dataset?.arrayPath ?? "",
        value: active.value ?? "",
        name: active.name ?? "",
        selectionStart: Number.isInteger(active.selectionStart) ? active.selectionStart : null,
        selectionEnd: Number.isInteger(active.selectionEnd) ? active.selectionEnd : null
      };
    }
    const ruleDetails = [...root.querySelectorAll("details[data-rule-id]")];
    const openRules = ruleDetails.filter(details => details.open).map(details => details.dataset.ruleId);
    const knownRules = ruleDetails.map(details => details.dataset.ruleId);
    this.viewState = { scroll, focus, openRules, knownRules, captured: true };
  }

  #restoreViewState() {
    const state = this.viewState;
    if (!state) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const root = this.element;
      if (!root) return;
      for (const [key, position] of Object.entries(state.scroll ?? {})) {
        const element = root.querySelector(`[data-scroll-key="${CSS.escape(key)}"]`);
        if (!element) continue;
        element.scrollTop = Number(position.top ?? 0);
        element.scrollLeft = Number(position.left ?? 0);
      }
      if (state.captured) {
        const openRules = new Set(state.openRules ?? []);
        const knownRules = new Set(state.knownRules ?? []);
        for (const details of root.querySelectorAll("details[data-rule-id]")) if (knownRules.has(details.dataset.ruleId)) details.open = openRules.has(details.dataset.ruleId);
      }
      const focus = state.focus;
      if (!focus) return;
      let element = null;
      if (focus.path) element = root.querySelector(`[data-path="${CSS.escape(focus.path)}"]`);
      else if (focus.arrayPath) element = [...root.querySelectorAll(`[data-array-path="${CSS.escape(focus.arrayPath)}"]`)].find(candidate => String(candidate.value) === String(focus.value));
      else if (focus.name) element = root.querySelector(`[name="${CSS.escape(focus.name)}"]`);
      if (!element) return;
      element.focus({ preventScroll: true });
      if (focus.selectionStart !== null && typeof element.setSelectionRange === "function") element.setSelectionRange(focus.selectionStart, focus.selectionEnd ?? focus.selectionStart);
    }));
  }

  #renderWithState({ resetContent = false } = {}) {
    this.#captureViewState();
    if (resetContent) {
      this.viewState.scroll ??= {};
      this.viewState.scroll["config-content"] = { top: 0, left: 0 };
      this.viewState.focus = null;
      this.viewState.openRules = [];
      this.viewState.knownRules = [];
      this.viewState.captured = false;
    }
    this.render();
  }

  #selectedProgressionProfile() {
    return this.draft.progressionProfiles?.find(profile => profile.id === this.selectedProgressionProfileId) ?? this.draft.progressionProfiles?.[0] ?? null;
  }

  #selectedProfile() {
    return this.draft.profiles.find(profile => profile.id === this.selectedProfileId) ?? this.draft.profiles[0] ?? null;
  }

  #normalizeProfile() {
    const index = this.draft.profiles.findIndex(profile => profile.id === this.selectedProfileId);
    if (index < 0) return;
    const profile = normalizeSupplierProfileV2(this.draft.profiles[index]);
    profile.icon = themeIcon(profile.theme, profile.customIcon);
    profile.mechanicalItemOverrides = Array.isArray(profile.mechanicalItemOverrides)
      ? profile.mechanicalItemOverrides.filter(item => item?.uuid).map(item => ({ uuid: String(item.uuid), excluded: item.excluded === true }))
      : [];
    this.draft.profiles[index] = profile;
    this.selectedProfileId = profile.id;
  }

  #syncForm() {
    const root = this.element;
    if (!root) return;
    root.querySelectorAll("[data-path]").forEach(input => {
      let value;
      if (input.type === "checkbox") value = input.checked;
      else if (input.type === "number") value = Number(input.value);
      else value = input.value;
      foundry.utils.setProperty(this.draft, input.dataset.path, value);
    });
    const arrayPaths = new Set([...root.querySelectorAll("[data-array-path]")].map(input => input.dataset.arrayPath));
    for (const path of arrayPaths) {
      const values = [...root.querySelectorAll(`[data-array-path="${CSS.escape(path)}"]`)].filter(input => input.checked).map(input => input.value);
      foundry.utils.setProperty(this.draft, path, values);
    }
    for (const progressionProfile of this.draft.progressionProfiles ?? []) {
      for (const band of progressionProfile.enchantmentBands ?? []) {
        band.weights ??= { 0: 0, 1: 0, 2: 0, 3: 0 };
        for (const bonus of [0, 1, 2, 3]) band.weights[bonus] = Number(band.weights[bonus] ?? 0);
      }
    }
    this.validationPlayers = Math.max(1, Number(root.querySelector("[name='validationPlayers']")?.value ?? this.validationPlayers));
    this.validationLevel = Math.min(20, Math.max(1, Number(root.querySelector("[name='validationLevel']")?.value ?? this.validationLevel)));
    this.#normalizeProfile();
  }
}
