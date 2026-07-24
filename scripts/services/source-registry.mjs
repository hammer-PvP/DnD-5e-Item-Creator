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
  "system.damage",
  "system.range",
  "system.properties",
  "system.price",
  "system.weight",
  "system.rarity",
  "system.magicalBonus",
  "system.attunement"
];

function packageLabel(pack) {
  const metadata = pack.metadata ?? {};
  const packageId = metadata.packageName ?? metadata.package ?? pack.collection.split(".")[0];
  if (metadata.packageType === "system" || packageId === game.system.id) return game.system.title;
  return game.modules.get(packageId)?.title ?? packageId;
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
  const properties = propertyValues(entry.system?.properties);
  const magicalBonus = String(entry.system?.magicalBonus ?? "").trim();
  return !properties.includes("mgc") && (!magicalBonus || Number(magicalBonus) === 0);
}

export class ItemCreatorSourceRegistry {
  static #instance;

  static get instance() {
    this.#instance ??= new ItemCreatorSourceRegistry();
    return this.#instance;
  }

  constructor() {
    this.weaponGroups = [];
    this.weaponByUuid = new Map();
    this.iconOptions = [];
    this.packSummaries = [];
    this.loaded = false;
    this.signature = "";
  }

  invalidate() {
    this.loaded = false;
    this.signature = "";
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
      summaries.push({
        collection: pack.collection,
        label: packLabel(pack),
        packageLabel: packageLabel(pack),
        weaponCount,
        enabled: this.isEnabled(pack.collection),
        search: `${packLabel(pack)} ${packageLabel(pack)}`.toLowerCase()
      });
    }

    summaries.sort((a, b) => a.packageLabel.localeCompare(b.packageLabel, game.i18n.lang)
      || a.label.localeCompare(b.label, game.i18n.lang));
    this.packSummaries = summaries;
    return summaries;
  }

  async loadWeapons({ force = false } = {}) {
    const settings = this.sourceSettings;
    const signature = `${settings.initialized}:${[...settings.enabledPacks].sort().join("|")}`;
    if (this.loaded && !force && signature === this.signature) return this;

    this.weaponGroups = [];
    this.weaponByUuid.clear();
    this.iconOptions = [];

    const packs = (await this.discoverWeaponPacks({ force }))
      .filter(summary => this.isEnabled(summary.collection));
    const iconPaths = new Set();

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
          collection: pack.collection,
          packLabel: summary.label,
          packageLabel: summary.packageLabel,
          search: String(entry.name ?? "").toLowerCase(),
          system: entry.system ?? {}
        };

        // Every Weapon document can contribute its image, including magical or special-source weapons.
        if (!iconPaths.has(option.img)) {
          iconPaths.add(option.img);
          this.iconOptions.push({
            img: option.img,
            name: option.name,
            uuid,
            source: `${summary.packageLabel} — ${summary.label}`,
            search: `${option.name} ${summary.packageLabel} ${summary.label}`.toLowerCase()
          });
        }

        // Base Item is intentionally mundane. Magical weapons remain available to the icon library only.
        if (!isBaseWeapon(entry)) continue;
        this.weaponByUuid.set(uuid, option);
        items.push(option);
      }
      items.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
      if (items.length) this.weaponGroups.push({ ...summary, items });
    }

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
