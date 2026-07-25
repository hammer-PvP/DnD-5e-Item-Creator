import { MODULE_ID, defaultSourceSettings } from "../constants.mjs";

const PACK_INDEX_FIELDS = [
  "name",
  "img",
  "type",
  "system.identifier",
  "system.type.value",
  "system.type.subtype",
  "system.type.baseItem",
  "system.mastery",
  "system.proficient",
  "system.ammunition.type",
  "system.damage",
  "system.range",
  "system.properties",
  "system.price",
  "system.weight",
  "system.quantity",
  "system.rarity",
  "system.magicalBonus",
  "system.attunement",
  "system.activities"
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
  return flags?.dnd5e?.sourceBook
    ?? flags?.sourceBook
    ?? pack.metadata?.sourceBook
    ?? "";
}

function normalizedOfficialSourceLabel(...values) {
  const combined = values.filter(Boolean).join(" ");
  for (const source of OFFICIAL_SOURCE_LABELS) {
    if (source.test.test(combined)) return source.label;
  }
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
  const id = `${packageId(pack)}-${label}`.toLowerCase();
  return id.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function sourceSortOrder(label) {
  const priorities = new Map([
    ["SRD 5.1", 10],
    ["SRD 5.2 Modern", 20],
    ["Player's Handbook 2024", 30],
    ["Dungeon Master's Guide", 40],
    ["Monster Manual", 50]
  ]);
  return priorities.get(label) ?? 100;
}

function packLabel(pack) {
  return game.i18n.localize(pack.metadata?.label ?? pack.title ?? pack.collection);
}

function propertyValues(properties) {
  if (properties instanceof Set) return [...properties];
  if (Array.isArray(properties)) return properties;
  if (properties && typeof properties === "object") return Object.entries(properties)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);
  return [];
}

function isBaseWeapon(entry) {
  const system = entry.system ?? {};
  const properties = propertyValues(system.properties);
  const magicalBonus = String(system.magicalBonus ?? "").trim();
  const rarity = String(system.rarity ?? "").trim();
  const attunement = String(system.attunement ?? "").trim();
  return !properties.includes("mgc")
    && (!magicalBonus || Number(magicalBonus) === 0)
    && !rarity
    && !attunement;
}

function normalizeSettings(stored) {
  const defaults = defaultSourceSettings();
  const value = stored && typeof stored === "object" ? stored : defaults;
  return {
    initialized: Boolean(value.initialized),
    enabledPacks: Array.isArray(value.enabledPacks) ? [...new Set(value.enabledPacks.map(String))] : [],
    packOrder: Array.isArray(value.packOrder) ? [...new Set(value.packOrder.map(String))] : []
  };
}

export class ItemCreatorSourceRegistry {
  static #instance;

  static get instance() {
    this.#instance ??= new ItemCreatorSourceRegistry();
    return this.#instance;
  }

  constructor() {
    this.weaponSourceGroups = [];
    this.weaponPackGroups = [];
    this.weaponOptions = [];
    this.weaponByUuid = new Map();
    this.iconOptions = [];
    this.packSummaries = [];
    this.activePackSummaries = [];
    this.loaded = false;
    this.signature = "";
  }

  invalidate() {
    this.loaded = false;
    this.signature = "";
    this.packSummaries = [];
    this.activePackSummaries = [];
  }

  get sourceSettings() {
    return normalizeSettings(game.settings.get(MODULE_ID, "sourceSettings"));
  }

  isEnabled(collection, settings = this.sourceSettings) {
    if (!settings.initialized) return true;
    return settings.enabledPacks.includes(collection);
  }

  priorityFor(collection, settings = this.sourceSettings) {
    const index = settings.packOrder.indexOf(collection);
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
  }

  orderedPackSummaries(summaries, settings = this.sourceSettings) {
    return [...summaries].sort((a, b) => {
      const aPriority = this.priorityFor(a.collection, settings);
      const bPriority = this.priorityFor(b.collection, settings);
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.sourceOrder - b.sourceOrder
        || a.sourceLabel.localeCompare(b.sourceLabel, game.i18n.lang)
        || a.label.localeCompare(b.label, game.i18n.lang);
    });
  }

  async discoverWeaponPacks({ force = false } = {}) {
    if (this.packSummaries.length && !force) {
      const settings = this.sourceSettings;
      return this.orderedPackSummaries(this.packSummaries.map(summary => ({
        ...summary,
        enabled: this.isEnabled(summary.collection, settings),
        priority: this.priorityFor(summary.collection, settings)
      })), settings);
    }

    const summaries = [];
    const settings = this.sourceSettings;

    for (const pack of game.packs) {
      if (pack.documentName !== "Item") continue;
      let index;
      try {
        index = await pack.getIndex({ fields: ["type"] });
      } catch (error) {
        console.warn(`${MODULE_ID} | Unable to inspect Item pack ${pack.collection}.`, error);
        continue;
      }
      const weaponCount = index.filter(entry => entry.type === "weapon").length;
      if (!weaponCount) continue;
      const label = packLabel(pack);
      const resolvedSourceLabel = sourceLabel(pack);
      const resolvedPackageTitle = packageTitle(pack);
      summaries.push({
        collection: pack.collection,
        label,
        packageId: packageId(pack),
        packageTitle: resolvedPackageTitle,
        sourceLabel: resolvedSourceLabel,
        sourceId: sourceId(pack, resolvedSourceLabel),
        sourceOrder: sourceSortOrder(resolvedSourceLabel),
        weaponCount,
        enabled: this.isEnabled(pack.collection, settings),
        priority: this.priorityFor(pack.collection, settings),
        search: `${label} ${resolvedSourceLabel} ${resolvedPackageTitle}`.toLowerCase()
      });
    }

    this.packSummaries = summaries;
    return this.orderedPackSummaries(summaries, settings);
  }

  async loadWeapons({ force = false } = {}) {
    const settings = this.sourceSettings;
    const signature = `${settings.initialized}:${settings.enabledPacks.join("|")}:${settings.packOrder.join("|")}`;
    if (this.loaded && !force && signature === this.signature) return this;

    this.weaponSourceGroups = [];
    this.weaponPackGroups = [];
    this.weaponOptions = [];
    this.weaponByUuid.clear();
    this.iconOptions = [];

    const packs = this.orderedPackSummaries(
      (await this.discoverWeaponPacks({ force })).filter(summary => this.isEnabled(summary.collection, settings)),
      settings
    ).map((summary, priority) => ({ ...summary, priority }));
    this.activePackSummaries = packs;

    const iconPaths = new Set();
    const sourceGroups = new Map();

    for (const summary of packs) {
      const pack = game.packs.get(summary.collection);
      if (!pack) continue;
      let index;
      try {
        index = await pack.getIndex({ fields: PACK_INDEX_FIELDS });
      } catch (error) {
        console.warn(`${MODULE_ID} | Unable to index ${pack.collection}.`, error);
        continue;
      }

      const weaponEntries = index.filter(entry => entry.type === "weapon");
      const items = [];
      for (const entry of weaponEntries) {
        const uuid = `Compendium.${pack.collection}.Item.${entry._id}`;
        const option = {
          id: entry._id,
          uuid,
          name: entry.name,
          img: entry.img || "icons/svg/sword.svg",
          type: entry.type,
          weaponType: entry.system?.type?.value ?? "",
          collection: pack.collection,
          packLabel: summary.label,
          sourceLabel: summary.sourceLabel,
          packageTitle: summary.packageTitle,
          priority: summary.priority,
          search: `${entry.name ?? ""} ${summary.label} ${summary.sourceLabel} ${summary.packageTitle}`.toLowerCase(),
          system: entry.system ?? {}
        };

        if (!iconPaths.has(option.img)) {
          iconPaths.add(option.img);
          this.iconOptions.push({
            img: option.img,
            name: option.name,
            uuid,
            collection: summary.collection,
            packLabel: summary.label,
            sourceLabel: summary.sourceLabel,
            priority: summary.priority,
            source: `${summary.sourceLabel} — ${summary.label}`,
            search: `${option.name} ${summary.sourceLabel} ${summary.label} ${summary.packageTitle}`.toLowerCase()
          });
        }

        if (!isBaseWeapon(entry)) continue;
        this.weaponByUuid.set(uuid, option);
        this.weaponOptions.push(option);
        items.push(option);
      }

      items.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
      if (!items.length) continue;

      this.weaponPackGroups.push({
        collection: summary.collection,
        label: summary.label,
        sourceLabel: summary.sourceLabel,
        packageTitle: summary.packageTitle,
        priority: summary.priority,
        weaponCount: items.length,
        items
      });

      let group = sourceGroups.get(summary.sourceId);
      if (!group) {
        group = {
          id: summary.sourceId,
          label: summary.sourceLabel,
          order: summary.priority,
          weaponCount: 0,
          packCount: 0,
          packs: []
        };
        sourceGroups.set(summary.sourceId, group);
      }
      group.order = Math.min(group.order, summary.priority);
      group.weaponCount += items.length;
      group.packCount += 1;
      group.packs.push({
        collection: summary.collection,
        label: summary.label,
        priority: summary.priority,
        weaponCount: items.length,
        items
      });
    }

    this.weaponPackGroups.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label, game.i18n.lang));
    this.weaponSourceGroups = [...sourceGroups.values()]
      .map(group => ({
        ...group,
        packs: group.packs.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label, game.i18n.lang))
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, game.i18n.lang));

    this.weaponOptions.sort((a, b) => a.priority - b.priority
      || a.name.localeCompare(b.name, game.i18n.lang)
      || a.packLabel.localeCompare(b.packLabel, game.i18n.lang));
    this.iconOptions.sort((a, b) => a.priority - b.priority
      || a.name.localeCompare(b.name, game.i18n.lang));
    this.loaded = true;
    this.signature = signature;
    return this;
  }

  findWeapon(uuid) {
    return this.weaponByUuid.get(uuid) ?? null;
  }


  describeDocument(document) {
    const collection = typeof document?.pack === "string"
      ? document.pack
      : document?.pack?.collection ?? document?.compendium?.collection ?? "";
    const pack = collection ? game.packs.get(collection) : null;
    if (!pack) {
      return {
        collection,
        label: "World Item",
        packLabel: "World Item",
        sourceLabel: "World",
        packageTitle: game.world?.title ?? "World"
      };
    }
    const resolvedSourceLabel = sourceLabel(pack);
    return {
      collection,
      label: packLabel(pack),
      packLabel: packLabel(pack),
      sourceLabel: resolvedSourceLabel,
      packageTitle: packageTitle(pack)
    };
  }

  async getWeaponDocument(uuid) {
    if (!uuid || !this.weaponByUuid.has(uuid)) return null;
    try {
      const document = await fromUuid(uuid);
      return document?.type === "weapon" ? document : null;
    } catch (error) {
      console.warn(`${MODULE_ID} | Unable to load weapon ${uuid}.`, error);
      return null;
    }
  }
}
