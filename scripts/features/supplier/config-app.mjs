import {
  ARMOR_SUBTYPE_KEYS,
  CATALOG_CATEGORIES,
  HAMMER_HOMEBREW_PROGRESSION_ID,
  MODULE_ID,
  RARITIES,
  RULE_CATEGORIES,
  SUPPLIER_THEMES,
  createDefaultCatalogRule,
  createDefaultGuaranteedRule,
  createDefaultRandomRule,
  createCustomProgressionProfile,
  createHammerHomebrewProgressionProfile,
  createRecommendedProgressionProfile
} from "./constants.mjs";
import {
  banKey,
  buildCatalog,
  clearCatalogCache,
  entriesForProfile,
  entryMatchesSubtype,
  isMechanicalItemExcluded,
  nativeSubtypeLabel,
  subtypeOptionsForCategory
} from "./catalog.mjs";
import { calculateRandomTarget, inspectRulePool } from "./generator.mjs";
import { SupplierItemPicker } from "./item-picker.mjs";
import { SupplierPoolInspector } from "./pool-inspector.mjs";
import { HomebrewSupplierPicker } from "./homebrew-supplier-picker.mjs";
import { applyHomebrewSupplierCuration } from "./homebrew-suppliers.mjs";
import { getConfiguration, saveConfiguration } from "./settings.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function newProfile() {
  const enabledSources = getConfiguration().sources.filter(source => source.enabled).map(source => source.id);
  return {
    id: foundry.utils.randomID(),
    name: game.i18n.localize("DND5E_SUPPLIER.Config.NewProfile"),
    theme: "general",
    icon: "fa-solid fa-basket-shopping",
    customIcon: "fa-solid fa-store",
    description: "",
    sourceIds: enabledSources,
    progressionProfileId: "world",
    homebrewTemplateId: "",
    homebrewAccessLevel: "",
    allowedItemTypes: [],
    stockTotalMode: "fixed",
    stockTotal: 10,
    mundaneCatalogRules: [],
    guaranteedRules: [],
    bannedItems: [],
    mechanicalItemOverrides: [],
    randomRules: []
  };
}

function duplicateSupplierProfile(source) {
  const copy = foundry.utils.deepClone(source);
  copy.id = foundry.utils.randomID();
  copy.name = game.i18n.format("DND5E_SUPPLIER.Config.SupplierCopyName", { name: source.name });
  for (const collection of [copy.mundaneCatalogRules, copy.guaranteedRules, copy.randomRules]) {
    for (const rule of collection ?? []) rule.id = foundry.utils.randomID();
  }
  copy.bannedItems = (copy.bannedItems ?? []).map(item => ({ ...item, id: foundry.utils.randomID() }));
  return copy;
}

function optionRows(values, selected, labelGetter = value => value) {
  const chosen = new Set(selected ?? []);
  return values.map(value => {
    const raw = typeof value === "string" ? value : value.value;
    return { value: raw, label: labelGetter(value), checked: chosen.has(raw) };
  });
}

function quantityFlags(value) {
  return {
    quantityFixed: value === "fixed",
    quantityPlayers: value === "players",
    quantityHalfDown: value === "halfDown",
    quantityHalfUp: value === "halfUp",
    quantityRange: value === "range",
    quantityRemainder: value === "remainder"
  };
}

function qualityFlags(value) {
  return {
    qualitySource: value === "source",
    qualityParty: value === "party",
    qualityMundane: value === "mundane",
    qualityFixed: value === "fixed"
  };
}

function minimumFlags(value) {
  return {
    minimumNone: value === "none",
    minimumFixed: value === "fixed",
    minimumPlayers: value === "players",
    minimumHalfDown: value === "halfDown",
    minimumHalfUp: value === "halfUp"
  };
}

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

function ruleSummary(rule, categoryLabel, kind) {
  if (!rule.category) return game.i18n.localize("DND5E_SUPPLIER.Config.ChooseCategory");
  const subtypeLabels = (rule.subtypes ?? []).map(nativeSubtypeLabel);
  const selection = subtypeLabels.length
    ? `${categoryLabel}: ${subtypeLabels.slice(0, 3).join(", ")}${subtypeLabels.length > 3 ? ` +${subtypeLabels.length - 3}` : ""}`
    : categoryLabel;
  if (kind === "random") return `${selection} • ${game.i18n.localize("DND5E_SUPPLIER.Config.WeightShort")} ${Math.max(0.1, Number(rule.randomWeight ?? 1))}`;
  const quantity = rule.quantityMode === "players"
    ? `${Number(rule.quantity ?? 1)} × ${game.i18n.localize("DND5E_SUPPLIER.Config.PlayersShort")}`
    : rule.quantityMode === "halfDown" || rule.quantityMode === "halfUp"
      ? game.i18n.localize("DND5E_SUPPLIER.Config.HalfPartyShort")
      : rule.quantityMode === "range"
        ? `${rule.quantityMin ?? 1}–${rule.quantityMax ?? 1}`
        : String(rule.quantity ?? 1);
  return `${selection} • ${quantity}`;
}

function themeIcon(themeId, customIcon) {
  if (themeId === "custom") return customIcon || "fa-solid fa-store";
  return SUPPLIER_THEMES.find(theme => theme.id === themeId)?.icon ?? "fa-solid fa-store";
}

function ruleList(profile, kind) {
  if (kind === "catalog") return profile?.mundaneCatalogRules;
  if (kind === "guaranteed") return profile?.guaranteedRules;
  return profile?.randomRules;
}

function supportsGeneratedQuality(rule) {
  if (rule.category === "weapon") return true;
  if (rule.category !== "equipment") return false;
  const subtypes = rule.subtypes ?? [];
  return subtypes.length > 0 && subtypes.every(subtype => ARMOR_SUBTYPE_KEYS.includes(subtype));
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
    this.section = "sources";
    this.selectedProfileId = this.draft.profiles?.[0]?.id ?? null;
    this.profileSection = "stock";
    this.bannedSection = "manual";
    this.selectedProgressionProfileId = this.draft.activeProgressionProfileId ?? this.draft.progressionProfiles?.[0]?.id ?? null;
    this.validationPlayers = 5;
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
    if (selectedProfile && !selectedProfile.sourceIds?.length) selectedProfile.sourceIds = globallyEnabled.map(source => source.id);

    let catalog = { entries: [], familyGroups: new Map(), grouped: new Map(), rawEntries: [] };
    let profileEntries = [];
    try {
      catalog = await buildCatalog({ configurationOverride: this.draft });
      profileEntries = selectedProfile ? entriesForProfile(catalog, selectedProfile, this.draft) : [];
    } catch (error) {
      console.warn(`${MODULE_ID} | Configuration pool preview unavailable`, error);
    }

    // Complete any Homebrew positive-list curation after compatible sources
    // become available. This also supports loading a model before packs are enabled.
    if (selectedProfile?.homebrewTemplateId && profileEntries.length) {
      applyHomebrewSupplierCuration(selectedProfile, catalog, this.draft);
    }

    // Convert legacy family presets into normal per-rule curation. This keeps
    // existing Alchemist profiles intact while removing the special family UI.
    if (selectedProfile && profileEntries.length) {
      for (const kind of ["catalog", "guaranteed", "random"]) {
        for (const rule of ruleList(selectedProfile, kind) ?? []) {
          const includedFamilies = new Set(rule.includeFamilies ?? []);
          if (!includedFamilies.size) continue;
          const unrestricted = foundry.utils.deepClone(rule);
          unrestricted.includeFamilies = [];
          unrestricted.poolExclusions = [];
          const candidates = inspectRulePool({
            rule: unrestricted,
            catalog,
            profileEntries,
            configuration: this.draft,
            applyProgression: false
          }).entries ?? [];
          const exclusions = new Set(rule.poolExclusions ?? []);
          for (const entry of candidates) {
            if (!(entry.familyIds ?? []).some(familyId => includedFamilies.has(familyId))) exclusions.add(entry.key);
          }
          rule.poolExclusions = [...exclusions];
          rule.includeFamilies = [];
        }
      }
    }

    const mapRule = (rule, index, kind) => {
      const pathMap = { catalog: "mundaneCatalogRules", guaranteed: "guaranteedRules", random: "randomRules" };
      const path = `profiles.${selectedIndex}.${pathMap[kind]}.${index}`;
      const inspection = inspectRulePool({
        rule,
        catalog,
        profileEntries,
        configuration: this.draft,
        applyProgression: false
      });
      const categoryValues = kind === "catalog" ? CATALOG_CATEGORIES : RULE_CATEGORIES;
      const categoryOptions = categoryValues.map(category => ({
        ...category,
        localized: game.i18n.localize(category.label),
        selected: category.value === rule.category
      }));
      const subtypeValues = ["weapon", "equipment", "consumable", "tool", "loot", "container"].includes(rule.category)
        ? subtypeOptionsForCategory(profileEntries, rule.category)
        : [];
      const poolExclusions = new Set((rule.poolExclusions ?? []).map(String));
      const subtypeOptions = optionRows(subtypeValues, rule.subtypes, option => option.label).map(option => {
        const subtypeRule = foundry.utils.deepClone(rule);
        subtypeRule.subtypes = [option.value];
        subtypeRule.poolExclusions = [];
        const subtypeInspection = inspectRulePool({
          rule: subtypeRule,
          catalog,
          profileEntries,
          configuration: this.draft,
          applyProgression: false
        });
        const eligibleKeys = (subtypeInspection.entries ?? []).map(entry => entry.key);
        const excludedCount = eligibleKeys.filter(key => poolExclusions.has(key)).length;
        const includedCount = Math.max(0, subtypeInspection.count - excludedCount);
        return {
          ...option,
          label: `${option.label} (${subtypeInspection.count})`,
          totalCount: subtypeInspection.count,
          includedCount,
          kind,
          index,
          subtype: option.value,
          excludedCount,
          hasCuration: excludedCount > 0
        };
      });
      const generatedQualityAvailable = supportsGeneratedQuality(rule);
      const categoryLabel = categoryOptions.find(option => option.selected)?.localized ?? game.i18n.localize("DND5E_SUPPLIER.Config.ChooseCategory");
      const poolReason = inspection.reason ? game.i18n.localize(`DND5E_SUPPLIER.PoolReason.${inspection.reason}`) : "";
      const poolSummary = inspection.count
        ? game.i18n.format("DND5E_SUPPLIER.Config.PoolCount", { count: inspection.count })
        : game.i18n.format("DND5E_SUPPLIER.Config.PoolEmpty", { reason: poolReason || game.i18n.localize("DND5E_SUPPLIER.PoolReason.category") });

      return {
        ...rule,
        index,
        kind,
        path,
        isCatalog: kind === "catalog",
        isGuaranteed: kind === "guaranteed",
        isRandom: kind === "random",
        hasCategory: Boolean(rule.category),
        isWeapon: rule.category === "weapon",
        isEquipment: rule.category === "equipment",
        isConsumable: rule.category === "consumable",
        isTool: rule.category === "tool",
        isLoot: rule.category === "loot",
        isContainer: rule.category === "container",
        isSpellScroll: rule.category === "spellScroll",
        isExact: rule.category === "exact",
        showSubtypeFilters: subtypeOptions.length > 0,
        showQuantity: kind !== "random",
        showRandomWeight: kind === "random",
        showQuality: kind !== "catalog" && generatedQualityAvailable,
        showMagicState: kind !== "catalog"
          && ["weapon", "equipment", "consumable", "tool", "loot", "container"].includes(rule.category)
          && (!generatedQualityAvailable || rule.qualityMode === "source"),
        generatedQualityAvailable,
        showCoverage: false,
        coverageSlots: rule.coverageMode !== "oneEach",
        coverageOneEach: rule.coverageMode === "oneEach",
        categoryOptions,
        categoryLabel,
        subtypeOptions,
        spellLevelOptions: Array.from({ length: 10 }, (_, level) => ({ level, checked: (rule.spellLevels ?? []).map(Number).includes(level) })),
        ...quantityFlags(rule.quantityMode),
        ...qualityFlags(rule.qualityMode),
        ...minimumFlags(rule.enchantedMinimumMode),
        fixedBonus1: Number(rule.fixedBonus) === 1,
        fixedBonus2: Number(rule.fixedBonus) === 2,
        fixedBonus3: Number(rule.fixedBonus) === 3,
        spellLevelByParty: rule.spellLevelMode === "level",
        spellLevelFixed: rule.spellLevelMode === "fixed",
        magicalAny: rule.magicalState === "any",
        magicalMundane: rule.magicalState === "mundane",
        magicalMagical: rule.magicalState === "magical",
        itemLabel: rule.itemLabel || game.i18n.localize("DND5E_SUPPLIER.Config.NoItemSelected"),
        poolCount: inspection.count,
        poolValid: inspection.count > 0,
        poolSummary,
        poolNames: inspection.names,
        poolBuckets: (inspection.buckets ?? []).map(bucket => ({
          ...bucket,
          label: bucket.key === "all" ? game.i18n.localize("DND5E_SUPPLIER.Config.AllEligibleItems") : nativeSubtypeLabel(bucket.key)
        })),
        hasMultipleBuckets: (inspection.buckets ?? []).length > 1,
        poolReason,
        randomWeight: Math.max(0.1, Number(rule.randomWeight ?? 1)),
        summary: ruleSummary(rule, categoryLabel, kind)
      };
    };

    const stockSections = selectedProfile ? [
      {
        kind: "catalog",
        title: game.i18n.localize("DND5E_SUPPLIER.Config.MundaneCatalog"),
        hint: game.i18n.localize("DND5E_SUPPLIER.Config.MundaneCatalogHint"),
        icon: "fa-solid fa-basket-shopping",
        addLabel: game.i18n.localize("DND5E_SUPPLIER.Config.AddCatalogGroup"),
        rules: (selectedProfile.mundaneCatalogRules ?? []).map((rule, index) => mapRule(rule, index, "catalog"))
      },
      {
        kind: "guaranteed",
        title: game.i18n.localize("DND5E_SUPPLIER.Config.GuaranteedItems"),
        hint: game.i18n.localize("DND5E_SUPPLIER.Config.GuaranteedHumanHint"),
        icon: "fa-solid fa-shield-halved",
        addLabel: game.i18n.localize("DND5E_SUPPLIER.Config.AddGuaranteedType"),
        rules: (selectedProfile.guaranteedRules ?? []).map((rule, index) => mapRule(rule, index, "guaranteed"))
      },
      {
        kind: "random",
        title: game.i18n.localize("DND5E_SUPPLIER.Config.RandomItems"),
        hint: game.i18n.localize("DND5E_SUPPLIER.Config.RandomHumanHint"),
        icon: "fa-solid fa-dice",
        addLabel: game.i18n.localize("DND5E_SUPPLIER.Config.AddRandomType"),
        rules: (selectedProfile.randomRules ?? []).map((rule, index) => mapRule(rule, index, "random"))
      }
    ] : [];

    const progressionProfiles = this.draft.progressionProfiles ?? [];
    const selectedProgressionIndex = Math.max(0, progressionProfiles.findIndex(profile => profile.id === this.selectedProgressionProfileId));
    const selectedProgressionProfile = progressionProfiles[selectedProgressionIndex] ?? null;
    if (selectedProgressionProfile && selectedProgressionProfile.id !== this.selectedProgressionProfileId) {
      this.selectedProgressionProfileId = selectedProgressionProfile.id;
    }

    const levelBands = (selectedProgressionProfile?.levelBands ?? []).map((band, index) => ({
      ...band,
      index,
      rarityOptions: optionRows(RARITIES, band.rarities, rarity => game.i18n.localize(rarity.label))
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
      sources: sources.map((source, index) => ({
        ...source,
        displayLabel: source.displayLabel || sourceDisplayLabel(source),
        index,
        canMoveUp: index > 0,
        canMoveDown: index < sources.length - 1
      })),
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
      currentTheme,
      themeOptions: SUPPLIER_THEMES.map(theme => ({
        ...theme,
        localized: game.i18n.localize(theme.label),
        selected: theme.id === selectedProfile?.theme,
        themeClass: `theme-${theme.id}`
      })),
      profileSourceOptions: globallyEnabled.map(source => ({ ...source, displayLabel: source.displayLabel || sourceDisplayLabel(source), checked: selectedProfile?.sourceIds?.includes(source.id) })),
      stockTotalFixed: selectedProfile?.stockTotalMode === "fixed",
      stockTotalPerPlayer: selectedProfile?.stockTotalMode !== "fixed",
      calculatedRandomTarget: selectedProfile ? calculateRandomTarget(selectedProfile, this.validationPlayers) : 0,
      activeCatalogRules: selectedProfile?.mundaneCatalogRules?.filter(rule => rule.enabled && rule.category).length ?? 0,
      activeGuaranteedRules: selectedProfile?.guaranteedRules?.filter(rule => rule.enabled && rule.category).length ?? 0,
      activeRandomRules: selectedProfile?.randomRules?.filter(rule => rule.enabled && rule.category).length ?? 0,
      stockSections,
      validationPlayers: this.validationPlayers,
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
      profileProgressionOptions: [
        {
          id: "world",
          displayName: game.i18n.format("DND5E_SUPPLIER.Config.WorldDefaultProgression", {
            name: activeWorldProgressionName
          }),
          selected: !selectedProfile?.progressionProfileId || selectedProfile?.progressionProfileId === "world"
        },
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
      selectedProfileIsHomebrew: Boolean(selectedProfile?.homebrewTemplateId),
      selectedProfileHomebrewLabel: selectedProfile?.homebrewTemplateId
        ? game.i18n.localize(`DND5E_SUPPLIER.Homebrew.${({ blacksmith: "Blacksmith", gunsmith: "Gunsmith", alchemist: "Alchemist", magic: "MagicAssortment", general: "GeneralTrade", stable: "StableLivestock" })[selectedProfile.homebrewTemplateId]}`)
        : "",
      selectedProfileAccessLabel: selectedProfile?.homebrewAccessLevel
        ? game.i18n.localize(`DND5E_SUPPLIER.Homebrew.Access${selectedProfile.homebrewAccessLevel}`)
        : game.i18n.localize("DND5E_SUPPLIER.Homebrew.AccessCustom"),
      selectedProfileAccessClass: ["1", "2", "3"].includes(String(selectedProfile?.homebrewAccessLevel))
        ? `access-${selectedProfile.homebrewAccessLevel}`
        : "access-custom",
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
      canDeleteProgressionProfile: progressionProfiles.length > 1 && !selectedProgressionProfile?.builtIn,
      useCorePricing: this.draft.useCorePricing !== false,
      levelBands,
      enchantmentBands,
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

    root.querySelectorAll("[data-section]").forEach(button => {
      button.addEventListener("click", () => {
        this.#syncForm();
        this.section = button.dataset.section;
        this.#renderWithState({ resetContent: true });
      });
    });

    root.querySelectorAll("[data-profile-id]").forEach(button => {
      button.addEventListener("click", () => {
        this.#syncForm();
        this.selectedProfileId = button.dataset.profileId;
        this.profileSection = "stock";
        this.bannedSection = "manual";
        this.#renderWithState({ resetContent: true });
      });
    });

    root.querySelectorAll("[data-rerender]").forEach(input => {
      input.addEventListener("change", () => {
        this.#syncForm();
        this.#renderWithState();
      });
    });

    root.querySelectorAll("[data-theme-id]").forEach(button => {
      button.addEventListener("click", () => {
        this.#syncForm();
        const profile = this.#selectedProfile();
        if (!profile) return;
        profile.theme = button.dataset.themeId;
        profile.icon = themeIcon(profile.theme, profile.customIcon);
        this.#renderWithState();
      });
    });

    root.querySelector("[data-action='add-profile']")?.addEventListener("click", () => {
      this.#syncForm();
      const sourceIds = this.draft.sources.filter(source => source.enabled).map(source => source.id);
      new HomebrewSupplierPicker({
        sourceIds,
        onCreate: async profile => {
          try {
            const catalog = await buildCatalog({ configurationOverride: this.draft });
            applyHomebrewSupplierCuration(profile, catalog, this.draft);
          } catch (error) {
            console.warn(`${MODULE_ID} | Homebrew Supplier curation could not be precomputed`, error);
          }
          this.draft.profiles.push(profile);
          this.selectedProfileId = profile.id;
          this.section = "profiles";
          this.profileSection = "stock";
          this.bannedSection = "manual";
          this.#renderWithState({ resetContent: true });
        }
      }).render(true);
    });

    root.querySelector("[data-action='duplicate-profile']")?.addEventListener("click", () => {
      this.#syncForm();
      const source = this.#selectedProfile();
      if (!source) return;
      const profile = duplicateSupplierProfile(source);
      this.draft.profiles.push(profile);
      this.selectedProfileId = profile.id;
      this.section = "profiles";
      this.profileSection = "stock";
      this.bannedSection = "manual";
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
      this.#renderWithState({ resetContent: true });
    });

    root.querySelectorAll("[data-action='add-rule']").forEach(button => {
      button.addEventListener("click", () => {
        this.#syncForm();
        const profile = this.#selectedProfile();
        if (!profile) return;
        if (button.dataset.kind === "catalog") profile.mundaneCatalogRules.push(createDefaultCatalogRule());
        else if (button.dataset.kind === "guaranteed") profile.guaranteedRules.push(createDefaultGuaranteedRule());
        else profile.randomRules.push(createDefaultRandomRule());
        this.#renderWithState();
      });
    });

    root.querySelectorAll("[data-action='remove-rule']").forEach(button => {
      button.addEventListener("click", () => {
        this.#syncForm();
        ruleList(this.#selectedProfile(), button.dataset.kind)?.splice(Number(button.dataset.index), 1);
        this.#renderWithState();
      });
    });

    root.querySelectorAll("[data-action='pick-exact']").forEach(button => {
      button.addEventListener("click", () => this.#openItemPicker(button));
    });

    root.querySelectorAll("[data-action='move-source']").forEach(button => {
      button.addEventListener("click", () => {
        this.#syncForm();
        const index = Number(button.dataset.index);
        const target = index + Number(button.dataset.direction);
        if (target < 0 || target >= this.draft.sources.length) return;
        [this.draft.sources[index], this.draft.sources[target]] = [this.draft.sources[target], this.draft.sources[index]];
        this.draft.sources.forEach((source, sourceIndex) => { source.priority = sourceIndex; });
        this.#renderWithState();
      });
    });

    root.querySelector("[data-action='select-progression-profile']")?.addEventListener("change", event => {
      this.#syncForm();
      this.selectedProgressionProfileId = event.currentTarget.value;
      this.draft.activeProgressionProfileId = this.selectedProgressionProfileId;
      this.#renderWithState({ resetContent: true });
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
      const baseline = target.homebrew
        ? createHammerHomebrewProgressionProfile()
        : createRecommendedProgressionProfile();
      const keepName = target.builtIn ? baseline.name : target.name;
      target.name = keepName;
      target.levelBands = foundry.utils.deepClone(baseline.levelBands);
      target.enchantmentBands = foundry.utils.deepClone(baseline.enchantmentBands);
      target.priceFallbacks = foundry.utils.deepClone(baseline.priceFallbacks);
      target.qualityPriceAdditions = foundry.utils.deepClone(baseline.qualityPriceAdditions);
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
      for (const supplierProfile of this.draft.profiles ?? []) {
        if (supplierProfile.progressionProfileId === removedId) supplierProfile.progressionProfileId = "world";
      }
      const next = this.draft.progressionProfiles[Math.max(0, index - 1)] ?? this.draft.progressionProfiles[0];
      this.selectedProgressionProfileId = next?.id ?? null;
      this.draft.activeProgressionProfileId = this.selectedProgressionProfileId;
      this.#renderWithState({ resetContent: true });
    });

    root.querySelector("[data-action='add-band']")?.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProgressionProfile();
      profile?.levelBands.push({ id: foundry.utils.randomID(), min: 1, max: 20, rarities: ["none", "common"], maxSpellLevel: 1 });
      this.#renderWithState();
    });
    root.querySelectorAll("[data-action='remove-band']").forEach(button => button.addEventListener("click", () => {
      this.#syncForm();
      this.#selectedProgressionProfile()?.levelBands.splice(Number(button.dataset.index), 1);
      this.#renderWithState();
    }));
    root.querySelectorAll("[data-profile-section]").forEach(button => {
      button.addEventListener("click", () => {
        this.#syncForm();
        this.profileSection = button.dataset.profileSection;
        if (this.profileSection === "banned" && !["manual", "mechanical"].includes(this.bannedSection)) this.bannedSection = "manual";
        this.#renderWithState({ resetContent: true });
      });
    });

    root.querySelectorAll("[data-banned-section]").forEach(button => {
      button.addEventListener("click", () => {
        this.#syncForm();
        this.bannedSection = button.dataset.bannedSection;
        this.#renderWithState({ resetContent: true });
      });
    });

    root.querySelectorAll("[data-source-toggle]").forEach(input => {
      input.addEventListener("change", () => {
        const index = Number(input.dataset.sourceToggle);
        if (!this.draft.sources[index]) return;
        this.draft.sources[index].enabled = input.checked;
      });
    });

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

    root.querySelectorAll("[data-action='remove-banned-item']").forEach(button => {
      button.addEventListener("click", () => {
        this.#syncForm();
        const profile = this.#selectedProfile();
        profile.bannedItems = (profile?.bannedItems ?? []).filter(item => item.id !== button.dataset.banId);
        this.#renderWithState();
      });
    });

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
        row.hidden = Boolean(
          (query && !row.dataset.name.includes(query))
          || (type && row.dataset.type !== type)
          || (source && row.dataset.source !== source)
          || (scope && row.dataset.scope !== scope)
        );
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

    root.querySelectorAll("[data-mechanical-toggle]").forEach(input => {
      input.addEventListener("change", event => {
        event.stopPropagation();
        this.#syncForm();
        const profile = this.#selectedProfile();
        if (!profile) return;
        setMechanicalOverride(profile, input.dataset.mechanicalToggle, input.checked);
        this.#renderWithState();
      });
    });

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
        row.hidden = Boolean(
          (query && !row.dataset.name.includes(query))
          || (type && row.dataset.type !== type)
          || (source && row.dataset.source !== source)
          || (state && row.dataset.state !== state)
        );
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

    root.querySelectorAll("[data-action='open-item-document']").forEach(button => {
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        const document = await fromUuid(button.dataset.uuid);
        document?.sheet?.render(true);
      });
    });

    root.querySelectorAll("[data-action='inspect-subtype']").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        this.#syncForm();
        const profile = this.#selectedProfile();
        const rule = ruleList(profile, button.dataset.kind)?.[Number(button.dataset.index)];
        if (!profile || !rule || !button.dataset.subtype) return;
        new SupplierPoolInspector({
          profile: foundry.utils.deepClone(profile),
          rule: foundry.utils.deepClone(rule),
          subtype: button.dataset.subtype,
          configuration: foundry.utils.deepClone(this.draft),
          onSave: exclusions => {
            rule.poolExclusions = exclusions.poolExclusions ?? [];
            rule.materializerExclusions = exclusions.materializerExclusions ?? [];
            this.#renderWithState();
          }
        }).render(true);
      });
    });

    root.querySelector("[data-action='add-quality-band']")?.addEventListener("click", () => {
      this.#syncForm();
      const profile = this.#selectedProgressionProfile();
      profile?.enchantmentBands.push({ id: foundry.utils.randomID(), min: 1, max: 20, weights: { 0: 100, 1: 0, 2: 0, 3: 0 } });
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

  #captureViewState() {
    const root = this.element;
    if (!root) return;
    const scroll = {};
    for (const element of root.querySelectorAll("[data-scroll-key]")) {
      scroll[element.dataset.scrollKey] = { top: element.scrollTop, left: element.scrollLeft };
    }

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
        for (const details of root.querySelectorAll("details[data-rule-id]")) {
          if (knownRules.has(details.dataset.ruleId)) details.open = openRules.has(details.dataset.ruleId);
        }
      }

      const focus = state.focus;
      if (!focus) return;
      let element = null;
      if (focus.path) element = root.querySelector(`[data-path="${CSS.escape(focus.path)}"]`);
      else if (focus.arrayPath) {
        element = [...root.querySelectorAll(`[data-array-path="${CSS.escape(focus.arrayPath)}"]`)]
          .find(candidate => String(candidate.value) === String(focus.value));
      } else if (focus.name) element = root.querySelector(`[name="${CSS.escape(focus.name)}"]`);
      if (!element) return;
      element.focus({ preventScroll: true });
      if (focus.selectionStart !== null && typeof element.setSelectionRange === "function") {
        element.setSelectionRange(focus.selectionStart, focus.selectionEnd ?? focus.selectionStart);
      }
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
    return this.draft.progressionProfiles?.find(profile => profile.id === this.selectedProgressionProfileId)
      ?? this.draft.progressionProfiles?.[0]
      ?? null;
  }

  #selectedProfile() {
    return this.draft.profiles.find(profile => profile.id === this.selectedProfileId) ?? this.draft.profiles[0];
  }

  #openItemPicker(button) {
    this.#syncForm();
    const rule = ruleList(this.#selectedProfile(), button.dataset.kind)?.[Number(button.dataset.index)];
    if (!rule) return;
    new SupplierItemPicker({
      profile: foundry.utils.deepClone(this.#selectedProfile()),
      configuration: foundry.utils.deepClone(this.draft),
      onSelect: selected => {
        rule.itemRef = selected.uuid;
        rule.itemLabel = selected.name;
        rule.itemRefs = [selected];
        this.#renderWithState();
      }
    }).render(true);
  }

  #normalizeRuleDependencies() {
    const profile = this.#selectedProfile();
    if (!profile) return;
    profile.icon = themeIcon(profile.theme, profile.customIcon);
    profile.progressionProfileId = String(profile.progressionProfileId ?? "world");
    profile.homebrewTemplateId = String(profile.homebrewTemplateId ?? "");
    profile.homebrewAccessLevel = String(profile.homebrewAccessLevel ?? "");
    profile.mechanicalItemOverrides = Array.isArray(profile.mechanicalItemOverrides)
      ? profile.mechanicalItemOverrides.filter(item => item?.uuid).map(item => ({ uuid: String(item.uuid), excluded: item.excluded === true }))
      : [];
    for (const kind of ["catalog", "guaranteed", "random"]) {
      for (const rule of ruleList(profile, kind) ?? []) {
        rule.weaponCategories = [];
        rule.weaponModes = [];
        rule.armorCategories = [];
        if (rule.subtypeCategory !== rule.category) {
          rule.subtypes = [];
          rule.poolExclusions = [];
          rule.subtypeCategory = rule.category;
        }
        if (rule.category === "healingPotions") {
          rule.category = "consumable";
          rule.subtypes = ["potion"];
          rule.subtypeCategory = "consumable";
          rule.includeFamilies = [...new Set([...(rule.includeFamilies ?? []), "healingPotions"])];
        }
        if (!["weapon", "equipment", "consumable", "tool", "loot", "container"].includes(rule.category)) rule.subtypes = [];
        if (rule.category !== "exact") {
          rule.itemRef = "";
          rule.itemLabel = "";
          rule.itemRefs = [];
        }
        rule.spellLevelMode = "level";
        if (rule.category !== "spellScroll") rule.spellLevels = [0, 1];
        if (kind === "catalog") {
          rule.countsTowardTotal = false;
          rule.magicalState = "mundane";
          rule.qualityMode = "mundane";
          rule.coverageMode = "all";
        }
        if (kind === "guaranteed") {
          rule.countsTowardTotal = false;
          rule.coverageMode = "slots";
        }
        if (kind === "random") {
          rule.countsTowardTotal = false;
          rule.quantityMode = "remainder";
          rule.randomWeight = Math.max(0.1, Number(rule.randomWeight ?? 1));
          rule.coverageMode = "slots";
        }
        rule.poolExclusions = Array.isArray(rule.poolExclusions) ? rule.poolExclusions : [];
        rule.includeFamilies = Array.isArray(rule.includeFamilies) ? rule.includeFamilies : [];
        delete rule.rarityMode;
        delete rule.rarities;
        if (!supportsGeneratedQuality(rule)) {
          rule.qualityMode = "source";
          rule.enchantedMinimumMode = "none";
          rule.enchantedMinimum = 0;
        } else if (["party", "mundane", "fixed"].includes(rule.qualityMode)) {
          rule.magicalState = "mundane";
        }
      }
    }
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
      const values = [...root.querySelectorAll(`[data-array-path="${CSS.escape(path)}"]`)]
        .filter(input => input.checked)
        .map(input => input.type === "number" ? Number(input.value) : input.value);
      foundry.utils.setProperty(this.draft, path, values);
    }

    for (const progressionProfile of this.draft.progressionProfiles ?? []) {
      for (const band of progressionProfile.enchantmentBands ?? []) {
        band.weights ??= { 0: 0, 1: 0, 2: 0, 3: 0 };
        for (const bonus of [0, 1, 2, 3]) band.weights[bonus] = Number(band.weights[bonus] ?? 0);
      }
    }
    this.validationPlayers = Math.max(1, Number(root.querySelector("[name='validationPlayers']")?.value ?? this.validationPlayers));
    this.#normalizeRuleDependencies();
  }
}
