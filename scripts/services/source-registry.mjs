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

export class ItemCreatorSourceRegistry {
  static #instance;

  static get instance() {
    this.#instance ??= new ItemCreatorSourceRegistry();
    return this.#instance;
  }

  constructor() {
    this.weaponSourceGroups = [];
    this.weaponOptions = [];
    this.weaponByUuid = new Map();
    this.iconOptions = [];
    this.packSummaries = [];
    this.loaded = false;
    this.signature = "";
  }

  invalidate() {
    this.loaded = false;
    this.signature = "";
    this.packSummaries = [];
  }

  get sourceSettings() {
    const stored = game.settings.get(MODULE_ID, "sourceSettings") ?? {};
    return foundry.utils.mergeObject(defaultSourceSettings(), stored, { inplace: false });
  }

  isEnabled(collection) {
    const settings = this.sourceSettings;
    if (!settings.initialized) return true;
    return settings.enabledPacks.includes(collection);
  }

  async discoverWeaponPacks({ force = false } = {}) {
    if (this.packSummaries.length && !force) return this.packSummaries;
    const summaries = [];

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
        enabled: this.isEnabled(pack.collection),
        search: `${label} ${resolvedSourceLabel} ${resolvedPackageTitle}`.toLowerCase()
      });
    }

    summaries.sort((a, b) => a.sourceOrder - b.sourceOrder
      || a.sourceLabel.localeCompare(b.sourceLabel, game.i18n.lang)
      || a.label.localeCompare(b.label, game.i18n.lang));
    this.packSummaries = summaries;
    return summaries;
  }

  async loadWeapons({ force = false } = {}) {
    const settings = this.sourceSettings;
    const signature = `${settings.initialized}:${[...settings.enabledPacks].sort().join("|")}`;
    if (this.loaded && !force && signature === this.signature) return this;

    this.weaponSourceGroups = [];
    this.weaponOptions = [];
    this.weaponByUuid.clear();
    this.iconOptions = [];

    const packs = (await this.discoverWeaponPacks({ force }))
      .filter(summary => this.isEnabled(summary.collection));
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
          search: `${entry.name ?? ""} ${summary.label} ${summary.sourceLabel}`.toLowerCase(),
          system: entry.system ?? {}
        };

        // Every Weapon document may contribute an icon, including magical and special-source weapons.
        if (!iconPaths.has(option.img)) {
          iconPaths.add(option.img);
          this.iconOptions.push({
            img: option.img,
            name: option.name,
            uuid,
            source: `${summary.sourceLabel} — ${summary.label}`,
            search: `${option.name} ${summary.sourceLabel} ${summary.label}`.toLowerCase()
          });
        }

        // Base Item intentionally starts from a non-magical template.
        if (!isBaseWeapon(entry)) continue;
        this.weaponByUuid.set(uuid, option);
        this.weaponOptions.push(option);
        items.push(option);
      }

      items.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
      if (!items.length) continue;

      let group = sourceGroups.get(summary.sourceId);
      if (!group) {
        group = {
          id: summary.sourceId,
          label: summary.sourceLabel,
          order: summary.sourceOrder,
          weaponCount: 0,
          packCount: 0,
          packs: []
        };
        sourceGroups.set(summary.sourceId, group);
      }
      group.weaponCount += items.length;
      group.packCount += 1;
      group.packs.push({
        collection: summary.collection,
        label: summary.label,
        weaponCount: items.length,
        items
      });
    }

    this.weaponSourceGroups = [...sourceGroups.values()]
      .map(group => ({
        ...group,
        packs: group.packs.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, game.i18n.lang));

    this.weaponOptions.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang)
      || a.sourceLabel.localeCompare(b.sourceLabel, game.i18n.lang)
      || a.packLabel.localeCompare(b.packLabel, game.i18n.lang));
    this.iconOptions.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    this.loaded = true;
    this.signature = signature;
    return this;
  }

  findWeapon(uuid) {
    return this.weaponByUuid.get(uuid) ?? null;
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
