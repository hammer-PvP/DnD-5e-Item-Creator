import { MODULE_ID, defaultSourceSettings } from "../constants.mjs";

const SUPPORTED_TYPES = new Set(["weapon", "equipment", "tool"]);

const PACK_INDEX_FIELDS = [
  "name", "img", "type",
  "system.identifier",
  "system.type.value", "system.type.subtype", "system.type.baseItem",
  "system.mastery", "system.proficient", "system.ammunition.type",
  "system.damage", "system.range", "system.properties",
  "system.price", "system.weight", "system.quantity",
  "system.rarity", "system.magicalBonus", "system.attunement",
  "system.equipped", "system.attuned", "system.armor", "system.strength",
  "system.activities", "system.ability", "system.bonus", "system.chatFlavor"
];

const OFFICIAL_SOURCE_LABELS = Object.freeze([
  { test: /(^|\b)srd\s*5[.]1(\b|$)/i, label: "SRD 5.1" },
  { test: /(^|\b)srd\s*5[.]2(\b|$)/i, label: "SRD 5.2 Modern" },
  { test: /(dnd[-_ ]players[-_ ]handbook|player'?s handbook)/i, label: "Player's Handbook 2024" },
  { test: /(dnd[-_ ]dungeon[-_ ]masters[-_ ]guide|dungeon master'?s guide)/i, label: "Dungeon Master's Guide" },
  { test: /(dnd[-_ ]monster[-_ ]manual|monster manual)/i, label: "Monster Manual" }
]);

function packageId(pack) {
  const metadata = pack.metadata ?? {};
  return metadata.packageName ?? metadata.package ?? pack.collection.split(".")[0];
}

function packageTitle(pack) {
  const id = packageId(pack);
  if (pack.metadata?.packageType === "system" || id === game.system.id) return game.system.title;
  return game.modules.get(id)?.title ?? id;
}

function sourceBook(pack) {
  const flags = pack.metadata?.flags ?? {};
  return flags?.dnd5e?.sourceBook ?? flags?.sourceBook ?? pack.metadata?.sourceBook ?? "";
}

function normalizedOfficialSourceLabel(...values) {
  const combined = values.filter(Boolean).join(" ");
  for (const source of OFFICIAL_SOURCE_LABELS) if (source.test.test(combined)) return source.label;
  return "";
}

function sourceLabel(pack) {
  const id = packageId(pack);
  const book = String(sourceBook(pack) ?? "").trim();
  const title = String(packageTitle(pack) ?? "").trim();
  const official = normalizedOfficialSourceLabel(book, id, title);
  if (official) return official;
  if (book) return book;
  if (pack.metadata?.packageType === "system" || id === game.system.id) {
    const packName = String(pack.metadata?.name ?? pack.collection.split(".").slice(1).join(".") ?? "");
    if (/24$/i.test(packName)) return "SRD 5.2 Modern";
    return "SRD 5.1";
  }
  return title.replace(/^Dungeons\s*&\s*Dragons\s+/i, "") || id;
}

function sourceId(pack, label) {
  return `${packageId(pack)}-${label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function sourceSortOrder(label) {
  const priorities = new Map([
    ["SRD 5.1", 10], ["SRD 5.2 Modern", 20], ["Player's Handbook 2024", 30],
    ["Dungeon Master's Guide", 40], ["Monster Manual", 50]
  ]);
  return priorities.get(label) ?? 100;
}

function packLabel(pack) {
  return game.i18n.localize(pack.metadata?.label ?? pack.title ?? pack.collection);
}

function propertyValues(properties) {
  if (properties instanceof Set) return [...properties];
  if (Array.isArray(properties)) return properties;
  if (properties && typeof properties === "object") return Object.entries(properties).filter(([, enabled]) => Boolean(enabled)).map(([key]) => key);
  return [];
}

function isBaseWeapon(entry) {
  const system = entry.system ?? {};
  const properties = propertyValues(system.properties);
  const magicalBonus = String(system.magicalBonus ?? "").trim();
  const rarity = String(system.rarity ?? "").trim();
  const attunement = String(system.attunement ?? "").trim();
  return !properties.includes("mgc") && (!magicalBonus || Number(magicalBonus) === 0) && !rarity && !attunement;
}

function normalizeIdentifier(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeSettings(stored) {
  const defaults = defaultSourceSettings();
  const value = stored && typeof stored === "object" ? stored : defaults;
  return {
    initialized: Boolean(value.initialized),
    enabledSources: Array.isArray(value.enabledSources) ? [...new Set(value.enabledSources.map(String))] : [],
    sourceOrder: Array.isArray(value.sourceOrder) ? [...new Set(value.sourceOrder.map(String))] : [],
    legacyEnabledPacks: Array.isArray(value.enabledPacks) ? [...new Set(value.enabledPacks.map(String))] : [],
    legacyPackOrder: Array.isArray(value.packOrder) ? [...new Set(value.packOrder.map(String))] : []
  };
}

function genericOption(entry, summary, pack) {
  const uuid = `Compendium.${pack.collection}.Item.${entry._id}`;
  return {
    id: entry._id,
    uuid,
    name: entry.name,
    img: entry.img || (entry.type === "weapon" ? "icons/svg/sword.svg" : "icons/svg/item-bag.svg"),
    type: entry.type,
    identifier: entry.system?.identifier ?? "",
    baseItemIdentifier: entry.system?.type?.baseItem ?? "",
    itemType: entry.system?.type?.value ?? "",
    weaponType: entry.type === "weapon" ? entry.system?.type?.value ?? "" : "",
    equipmentType: entry.type === "equipment" ? entry.system?.type?.value ?? "" : "",
    toolType: entry.type === "tool" ? entry.system?.type?.value ?? "" : "",
    collection: pack.collection,
    packLabel: summary.label,
    sourceLabel: summary.sourceLabel,
    sourceId: summary.sourceId,
    packageTitle: summary.packageTitle,
    priority: summary.sourcePriority,
    search: `${entry.name ?? ""} ${summary.label} ${summary.sourceLabel} ${summary.packageTitle}`.toLowerCase(),
    system: entry.system ?? {}
  };
}

export class ItemCreatorSourceRegistry {
  static #instance;
  static get instance() { this.#instance ??= new ItemCreatorSourceRegistry(); return this.#instance; }

  constructor() {
    this.weaponSourceGroups = [];
    this.weaponPackGroups = [];
    this.weaponOptions = [];
    this.templateSourceGroups = [];
    this.templateOptions = [];
    this.templateByUuid = new Map();
    this.weaponByUuid = new Map();
    this.weaponByIdentifier = new Map();

    this.equipmentSourceGroups = [];
    this.equipmentPackGroups = [];
    this.equipmentOptions = [];
    this.equipmentTemplateSourceGroups = [];
    this.equipmentTemplateOptions = [];
    this.equipmentByUuid = new Map();

    this.toolSourceGroups = [];
    this.toolPackGroups = [];
    this.toolOptions = [];
    this.toolTemplateSourceGroups = [];
    this.toolTemplateOptions = [];
    this.toolByUuid = new Map();

    this.iconOptions = [];
    this.packSummaries = [];
    this.sourceSummaries = [];
    this.activePackSummaries = [];
    this.loaded = false;
    this.signature = "";
  }

  invalidate() {
    this.loaded = false;
    this.signature = "";
    this.packSummaries = [];
    this.sourceSummaries = [];
    this.activePackSummaries = [];
  }

  get rawSourceSettings() { return normalizeSettings(game.settings.get(MODULE_ID, "sourceSettings")); }

  resolveSourceSettings(sources = this.sourceSummaries) {
    const raw = this.rawSourceSettings;
    const availableIds = sources.map(source => source.id);
    const available = new Set(availableIds);
    let enabledSources = raw.enabledSources.filter(id => available.has(id));
    let sourceOrder = raw.sourceOrder.filter(id => available.has(id));

    if (!raw.enabledSources.length && raw.legacyEnabledPacks.length) {
      enabledSources = sources.filter(source => source.packs.some(pack => raw.legacyEnabledPacks.includes(pack.collection))).map(source => source.id);
    }
    if (!raw.sourceOrder.length && raw.legacyPackOrder.length) {
      sourceOrder = [...sources].sort((a, b) => {
        const indexFor = source => Math.min(...source.packs.map(pack => {
          const index = raw.legacyPackOrder.indexOf(pack.collection);
          return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
        }));
        return indexFor(a) - indexFor(b) || a.order - b.order || a.label.localeCompare(b.label, game.i18n.lang);
      }).map(source => source.id);
    }
    for (const id of availableIds) if (!sourceOrder.includes(id)) sourceOrder.push(id);
    if (!raw.initialized) enabledSources = [...availableIds];
    return { initialized: raw.initialized, enabledSources: [...new Set(enabledSources)], sourceOrder: [...new Set(sourceOrder)] };
  }

  get sourceSettings() { return this.resolveSourceSettings(); }
  isSourceEnabled(id, settings = this.sourceSettings) { return !settings.initialized || settings.enabledSources.includes(id); }
  priorityForSource(id, settings = this.sourceSettings) { const index = settings.sourceOrder.indexOf(id); return index >= 0 ? index : Number.MAX_SAFE_INTEGER; }
  orderedSources(sources, settings = this.resolveSourceSettings(sources)) {
    return [...sources].sort((a, b) => this.priorityForSource(a.id, settings) - this.priorityForSource(b.id, settings)
      || a.order - b.order || a.label.localeCompare(b.label, game.i18n.lang));
  }

  async discoverItemPacks({ force = false } = {}) {
    if (this.packSummaries.length && !force) return [...this.packSummaries];
    const summaries = [];
    for (const pack of game.packs) {
      if (pack.documentName !== "Item") continue;
      let index;
      try { index = await pack.getIndex({ fields: ["type", "system.type.value"] }); }
      catch (error) { console.warn(`${MODULE_ID} | Unable to inspect Item pack ${pack.collection}.`, error); continue; }
      const counts = Object.fromEntries([...SUPPORTED_TYPES].map(type => [type, index.filter(entry => entry.type === type
        && !(type === "equipment" && entry.system?.type?.value === "vehicle")).length]));
      const itemCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
      if (!itemCount) continue;
      const label = packLabel(pack);
      const resolvedSourceLabel = sourceLabel(pack);
      const resolvedPackageTitle = packageTitle(pack);
      summaries.push({
        collection: pack.collection, label,
        packageId: packageId(pack), packageTitle: resolvedPackageTitle,
        sourceLabel: resolvedSourceLabel, sourceId: sourceId(pack, resolvedSourceLabel),
        sourceOrder: sourceSortOrder(resolvedSourceLabel),
        itemCount, weaponCount: counts.weapon, equipmentCount: counts.equipment, toolCount: counts.tool,
        search: `${label} ${resolvedSourceLabel} ${resolvedPackageTitle}`.toLowerCase()
      });
    }
    this.packSummaries = summaries;
    this.sourceSummaries = this.#groupSources(summaries);
    return [...summaries];
  }

  async discoverWeaponPacks(options = {}) { return this.discoverItemPacks(options); }
  async discoverItemSources({ force = false } = {}) {
    await this.discoverItemPacks({ force });
    const settings = this.resolveSourceSettings(this.sourceSummaries);
    return this.orderedSources(this.sourceSummaries, settings).map(source => ({
      ...source, enabled: this.isSourceEnabled(source.id, settings), priority: this.priorityForSource(source.id, settings)
    }));
  }
  async discoverWeaponSources(options = {}) { return this.discoverItemSources(options); }

  #groupSources(packs) {
    const groups = new Map();
    for (const pack of packs) {
      let group = groups.get(pack.sourceId);
      if (!group) {
        group = {
          id: pack.sourceId, label: pack.sourceLabel, order: pack.sourceOrder,
          packageTitle: pack.packageTitle, packageTitles: new Set(),
          itemCount: 0, weaponCount: 0, equipmentCount: 0, toolCount: 0, packs: [], search: ""
        };
        groups.set(pack.sourceId, group);
      }
      group.order = Math.min(group.order, pack.sourceOrder);
      group.itemCount += pack.itemCount;
      group.weaponCount += pack.weaponCount;
      group.equipmentCount += pack.equipmentCount;
      group.toolCount += pack.toolCount;
      group.packageTitles.add(pack.packageTitle);
      group.packs.push(pack);
    }
    return [...groups.values()].map(group => ({
      ...group,
      packageTitles: [...group.packageTitles],
      packCount: group.packs.length,
      search: `${group.label} ${[...group.packageTitles].join(" ")}`.toLowerCase(),
      packs: [...group.packs].sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
    })).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, game.i18n.lang));
  }

  async loadAll({ force = false } = {}) {
    const sources = await this.discoverItemSources({ force });
    const settings = this.resolveSourceSettings(sources);
    const signature = `${settings.initialized}:${settings.enabledSources.join("|")}:${settings.sourceOrder.join("|")}`;
    if (this.loaded && !force && signature === this.signature) return this;

    this.weaponSourceGroups = []; this.weaponPackGroups = []; this.weaponOptions = [];
    this.templateSourceGroups = []; this.templateOptions = []; this.templateByUuid.clear();
    this.weaponByUuid.clear(); this.weaponByIdentifier.clear();
    this.equipmentSourceGroups = []; this.equipmentPackGroups = []; this.equipmentOptions = [];
    this.equipmentTemplateSourceGroups = []; this.equipmentTemplateOptions = []; this.equipmentByUuid.clear();
    this.toolSourceGroups = []; this.toolPackGroups = []; this.toolOptions = [];
    this.toolTemplateSourceGroups = []; this.toolTemplateOptions = []; this.toolByUuid.clear();
    this.iconOptions = [];

    const activeSources = this.orderedSources(sources.filter(source => this.isSourceEnabled(source.id, settings)), settings)
      .map((source, priority) => ({ ...source, priority }));
    const packs = activeSources.flatMap(source => source.packs.map(pack => ({
      ...pack, sourcePriority: source.priority, sourceLabel: source.label, sourceId: source.id
    }))).sort((a, b) => a.sourcePriority - b.sourcePriority || a.label.localeCompare(b.label, game.i18n.lang));
    this.activePackSummaries = packs;

    const iconPaths = new Set();
    const sourceGroups = { weapon: new Map(), equipment: new Map(), tool: new Map() };
    const templateGroups = { weapon: new Map(), equipment: new Map(), tool: new Map() };

    for (const summary of packs) {
      const pack = game.packs.get(summary.collection);
      if (!pack) continue;
      let index;
      try { index = await pack.getIndex({ fields: PACK_INDEX_FIELDS }); }
      catch (error) { console.warn(`${MODULE_ID} | Unable to index ${pack.collection}.`, error); continue; }

      // Icon choice is deliberately type-agnostic. Index every Item image in an
      // active pack, while Base Item lists remain restricted to supported types.
      for (const entry of index) {
        if (!entry?.img || iconPaths.has(entry.img)) continue;
        iconPaths.add(entry.img);
        const option = genericOption(entry, summary, pack);
        this.iconOptions.push({
          img: option.img, name: option.name, uuid: option.uuid, itemType: entry.type,
          collection: summary.collection, packLabel: summary.label, sourceLabel: summary.sourceLabel,
          priority: summary.sourcePriority, source: `${summary.sourceLabel} — ${summary.label}`,
          search: `${option.name} ${entry.type ?? ""} ${summary.sourceLabel} ${summary.label} ${summary.packageTitle}`.toLowerCase()
        });
      }

      for (const type of SUPPORTED_TYPES) {
        const entries = index.filter(entry => entry.type === type
          && !(type === "equipment" && entry.system?.type?.value === "vehicle"));
        const baseItems = [];
        for (const entry of entries) {
          const option = genericOption(entry, summary, pack);
          let group = templateGroups[type].get(summary.sourceId);
          if (!group) {
            group = { id: summary.sourceId, label: summary.sourceLabel, order: summary.sourcePriority, items: [] };
            templateGroups[type].set(summary.sourceId, group);
          }
          group.items.push(option);

          if (type === "weapon") {
            this.templateByUuid.set(option.uuid, option);
            this.templateOptions.push(option);
          } else if (type === "equipment") {
            this.equipmentByUuid.set(option.uuid, option);
            this.equipmentTemplateOptions.push(option);
            this.equipmentOptions.push(option);
          } else {
            this.toolByUuid.set(option.uuid, option);
            this.toolTemplateOptions.push(option);
            this.toolOptions.push(option);
          }

          if (type === "weapon" && isBaseWeapon(entry)) {
            this.weaponByUuid.set(option.uuid, option);
            this.weaponOptions.push(option);
            baseItems.push(option);
            const identifiers = new Set([normalizeIdentifier(option.baseItemIdentifier), normalizeIdentifier(option.identifier)].filter(Boolean));
            for (const identifier of identifiers) {
              const matches = this.weaponByIdentifier.get(identifier) ?? [];
              matches.push(option);
              this.weaponByIdentifier.set(identifier, matches);
            }
          } else baseItems.push(option);
        }

        baseItems.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
        if (!baseItems.length) continue;
        const packGroup = {
          collection: summary.collection, label: summary.label, sourceLabel: summary.sourceLabel,
          packageTitle: summary.packageTitle, priority: summary.sourcePriority,
          itemCount: baseItems.length, weaponCount: type === "weapon" ? baseItems.length : 0,
          equipmentCount: type === "equipment" ? baseItems.length : 0,
          toolCount: type === "tool" ? baseItems.length : 0, items: baseItems
        };
        if (type === "weapon") this.weaponPackGroups.push(packGroup);
        else if (type === "equipment") this.equipmentPackGroups.push(packGroup);
        else this.toolPackGroups.push(packGroup);

        let sourceGroup = sourceGroups[type].get(summary.sourceId);
        if (!sourceGroup) {
          sourceGroup = { id: summary.sourceId, label: summary.sourceLabel, order: summary.sourcePriority, itemCount: 0, packCount: 0, packs: [] };
          sourceGroups[type].set(summary.sourceId, sourceGroup);
        }
        sourceGroup.itemCount += baseItems.length;
        sourceGroup.packCount += 1;
        sourceGroup.packs.push({ collection: summary.collection, label: summary.label, priority: summary.sourcePriority, itemCount: baseItems.length, items: baseItems });
      }
    }

    const sortOptions = list => list.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, game.i18n.lang) || a.packLabel.localeCompare(b.packLabel, game.i18n.lang));
    sortOptions(this.templateOptions); sortOptions(this.weaponOptions); sortOptions(this.equipmentTemplateOptions); sortOptions(this.equipmentOptions); sortOptions(this.toolTemplateOptions); sortOptions(this.toolOptions); sortOptions(this.iconOptions);
    for (const matches of this.weaponByIdentifier.values()) sortOptions(matches);

    const finalizeTemplateGroups = map => [...map.values()].map(group => ({
      ...group,
      items: group.items.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang) || a.packLabel.localeCompare(b.packLabel, game.i18n.lang))
    })).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, game.i18n.lang));
    this.templateSourceGroups = finalizeTemplateGroups(templateGroups.weapon);
    this.equipmentTemplateSourceGroups = finalizeTemplateGroups(templateGroups.equipment);
    this.toolTemplateSourceGroups = finalizeTemplateGroups(templateGroups.tool);

    const finalizeSourceGroups = map => [...map.values()].map(group => ({
      ...group, packs: group.packs.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
    })).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, game.i18n.lang));
    this.weaponSourceGroups = finalizeSourceGroups(sourceGroups.weapon);
    this.equipmentSourceGroups = finalizeSourceGroups(sourceGroups.equipment);
    this.toolSourceGroups = finalizeSourceGroups(sourceGroups.tool);
    this.weaponPackGroups.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label, game.i18n.lang));
    this.equipmentPackGroups.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label, game.i18n.lang));
    this.toolPackGroups.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label, game.i18n.lang));

    this.loaded = true;
    this.signature = signature;
    return this;
  }

  async loadWeapons(options = {}) { return this.loadAll(options); }
  async loadEquipment(options = {}) { return this.loadAll(options); }
  async loadTools(options = {}) { return this.loadAll(options); }

  findWeapon(uuid) { return this.templateByUuid.get(uuid) ?? this.weaponByUuid.get(uuid) ?? null; }
  findTemplate(uuid) { return this.templateByUuid.get(uuid) ?? null; }
  findEquipment(uuid) { return this.equipmentByUuid.get(uuid) ?? null; }
  findEquipmentTemplate(uuid) { return this.equipmentByUuid.get(uuid) ?? null; }
  findTool(uuid) { return this.toolByUuid.get(uuid) ?? null; }
  findToolTemplate(uuid) { return this.toolByUuid.get(uuid) ?? null; }

  findBaseWeaponByIdentifier(identifier) {
    const normalized = normalizeIdentifier(identifier);
    return normalized ? this.weaponByIdentifier.get(normalized)?.[0] ?? null : null;
  }

  describeDocument(document) {
    const collection = typeof document?.pack === "string" ? document.pack : document?.pack?.collection ?? document?.compendium?.collection ?? "";
    const pack = collection ? game.packs.get(collection) : null;
    if (!pack) return { collection, label: "World Item", packLabel: "World Item", sourceLabel: "World", packageTitle: game.world?.title ?? "World" };
    const resolvedSourceLabel = sourceLabel(pack);
    return {
      collection, label: packLabel(pack), packLabel: packLabel(pack), sourceLabel: resolvedSourceLabel,
      sourceId: sourceId(pack, resolvedSourceLabel), packageTitle: packageTitle(pack)
    };
  }

  async getItemDocument(uuid, type) {
    if (!uuid) return null;
    try {
      const document = await fromUuid(uuid);
      return document?.type === type ? document : null;
    } catch (error) {
      console.warn(`${MODULE_ID} | Unable to load ${type} ${uuid}.`, error);
      return null;
    }
  }
  async getWeaponDocument(uuid) { return this.getItemDocument(uuid, "weapon"); }
  async getEquipmentDocument(uuid) { return this.getItemDocument(uuid, "equipment"); }
  async getToolDocument(uuid) { return this.getItemDocument(uuid, "tool"); }
}
