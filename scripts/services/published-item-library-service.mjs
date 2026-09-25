import { MODULE_ID } from "../constants.mjs";

export const PUBLISHED_LIBRARY_PACK_NAME = "item-creator-published-items";
export const PUBLISHED_LIBRARY_LABEL = "Item Creator — Published Items";
export const PUBLISHED_LIBRARY_SIDEBAR_FOLDER = "Item Creator";

const CATEGORY_DEFINITIONS = Object.freeze([
  { id: "weapon", label: "Weapons", icon: "fa-khanda", types: ["weapon"] },
  { id: "equipment", label: "Equipment", icon: "fa-shield-halved", types: ["equipment"] },
  { id: "consumable", label: "Consumables", icon: "fa-flask", types: ["consumable"] },
  { id: "tool", label: "Tools", icon: "fa-hammer", types: ["tool"] },
  { id: "other", label: "Other", icon: "fa-box", types: [] }
]);

// Canonical pack hierarchy. These are real Folder documents stored inside the
// world Compendium, not a second metadata database. The structure intentionally
// mirrors the degree of organization used by official D&D5e equipment packs.
const LIBRARY_FOLDER_DEFINITIONS = Object.freeze([
  { key: "adventuring-gear", label: "Adventuring Gear", icon: "fa-box-open", parent: null, order: 10 },

  { key: "armor", label: "Armor", icon: "fa-shield-halved", parent: null, order: 20 },
  { key: "armor-light", label: "Light", icon: "fa-shield", parent: "armor", order: 21 },
  { key: "armor-medium", label: "Medium", icon: "fa-shield", parent: "armor", order: 22 },
  { key: "armor-heavy", label: "Heavy", icon: "fa-shield", parent: "armor", order: 23 },
  { key: "armor-shields", label: "Shields", icon: "fa-shield-halved", parent: "armor", order: 24 },
  { key: "armor-other", label: "Other Armor", icon: "fa-shield", parent: "armor", order: 25 },

  { key: "tools", label: "Tools", icon: "fa-hammer", parent: null, order: 30 },
  { key: "tools-artisan", label: "Artisan's Tools", icon: "fa-hammer", parent: "tools", order: 31 },
  { key: "tools-gaming", label: "Gaming Sets", icon: "fa-dice", parent: "tools", order: 32 },
  { key: "tools-music", label: "Musical Instruments", icon: "fa-music", parent: "tools", order: 33 },
  { key: "tools-other", label: "Other Tools", icon: "fa-hammer", parent: "tools", order: 34 },

  { key: "weapons", label: "Weapons", icon: "fa-khanda", parent: null, order: 40 },
  { key: "weapons-simple-melee", label: "Simple Melee", icon: "fa-khanda", parent: "weapons", order: 41 },
  { key: "weapons-simple-ranged", label: "Simple Ranged", icon: "fa-bullseye", parent: "weapons", order: 42 },
  { key: "weapons-martial-melee", label: "Martial Melee", icon: "fa-khanda", parent: "weapons", order: 43 },
  { key: "weapons-martial-ranged", label: "Martial Ranged", icon: "fa-bullseye", parent: "weapons", order: 44 },
  { key: "weapons-other", label: "Other Weapons", icon: "fa-khanda", parent: "weapons", order: 45 },

  { key: "consumables", label: "Consumables", icon: "fa-flask", parent: null, order: 50 },
  { key: "consumables-potions", label: "Potions", icon: "fa-flask", parent: "consumables", order: 51 },
  { key: "consumables-scrolls", label: "Scrolls", icon: "fa-scroll", parent: "consumables", order: 52 },
  { key: "consumables-other", label: "Other Consumables", icon: "fa-flask", parent: "consumables", order: 53 },

  { key: "other", label: "Other / Uncategorized", icon: "fa-box", parent: null, order: 90 }
]);

function clone(value) {
  return foundry.utils.deepClone(value);
}

function now() {
  return Date.now();
}

function collectionId() {
  return `world.${PUBLISHED_LIBRARY_PACK_NAME}`;
}

function publicationFlag(item) {
  return item?.flags?.[MODULE_ID]?.publication ?? null;
}

function categoryForItem(item) {
  return CATEGORY_DEFINITIONS.find(category => category.types.includes(item?.type))?.id ?? "other";
}

function categoryLabel(categoryId) {
  return CATEGORY_DEFINITIONS.find(category => category.id === categoryId)?.label ?? "Other";
}

function typeValue(item) {
  const raw = item?.system?.type?.value ?? item?.system?.type ?? "";
  return typeof raw === "string" ? raw : "";
}

function libraryFolderKeyForItem(item) {
  const itemType = String(item?.type ?? "");
  const subtype = typeValue(item);

  if (itemType === "weapon") {
    return ({
      simpleM: "weapons-simple-melee",
      simpleR: "weapons-simple-ranged",
      martialM: "weapons-martial-melee",
      martialR: "weapons-martial-ranged"
    })[subtype] ?? "weapons-other";
  }

  if (itemType === "equipment") {
    return ({
      light: "armor-light",
      medium: "armor-medium",
      heavy: "armor-heavy",
      shield: "armor-shields",
      natural: "armor-other"
    })[subtype] ?? "adventuring-gear";
  }

  if (itemType === "tool") {
    return ({
      art: "tools-artisan",
      game: "tools-gaming",
      music: "tools-music"
    })[subtype] ?? "tools-other";
  }

  if (itemType === "consumable") {
    if (subtype === "potion") return "consumables-potions";
    if (subtype === "scroll") return "consumables-scrolls";
    return "consumables-other";
  }

  return "other";
}

function folderDefinition(key) {
  return LIBRARY_FOLDER_DEFINITIONS.find(definition => definition.key === key) ?? LIBRARY_FOLDER_DEFINITIONS.at(-1);
}

function sanitizeForCompendium(data) {
  const source = clone(data ?? {});
  delete source._id;
  delete source._stats;
  delete source.sort;
  delete source.ownership;
  source.folder = null;
  return source;
}

function folderFlag(folder) {
  return folder?.flags?.[MODULE_ID]?.publishedLibraryFolder ?? null;
}

function isSidebarLibraryFolder(folder) {
  return Boolean(folder?.flags?.[MODULE_ID]?.publishedLibraryRoot);
}

function buildDisplayTree(rows) {
  const byKey = new Map(LIBRARY_FOLDER_DEFINITIONS.map(definition => [definition.key, {
    ...definition,
    items: [],
    children: [],
    count: 0
  }]));

  for (const row of rows) {
    const key = byKey.has(row.folderKey) ? row.folderKey : "other";
    byKey.get(key).items.push(row);
  }
  for (const node of byKey.values()) node.items.sort((a, b) => a.name.localeCompare(b.name));

  const roots = [];
  for (const definition of LIBRARY_FOLDER_DEFINITIONS) {
    const node = byKey.get(definition.key);
    if (definition.parent && byKey.has(definition.parent)) byKey.get(definition.parent).children.push(node);
    else roots.push(node);
  }
  for (const node of byKey.values()) node.children.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  const countNode = node => {
    node.count = node.items.length + node.children.reduce((total, child) => total + countNode(child), 0);
    return node.count;
  };
  roots.forEach(countNode);
  return roots.filter(node => node.count > 0).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export class PublishedItemLibraryService {
  static get packId() { return collectionId(); }
  static get categories() { return CATEGORY_DEFINITIONS; }
  static get folderDefinitions() { return LIBRARY_FOLDER_DEFINITIONS; }

  static getPack() {
    return game.packs.get(collectionId())
      ?? game.packs.find(pack => pack?.collection === collectionId())
      ?? null;
  }

  static async ensurePack({ unlock = false, organize = true } = {}) {
    if (!game.user?.isGM) throw new Error("Only a GM can manage the Item Creator Published Library.");
    let pack = this.getPack();
    // On first creation, establish the Compendium sidebar group first so the
    // library is born inside the Item Creator group rather than appearing loose.
    if (!pack) await this.#ensureSidebarFolder(null);
    if (!pack) {
      const CompendiumCollection = foundry.documents.collections.CompendiumCollection;
      try {
        pack = await CompendiumCollection.createCompendium({
          name: PUBLISHED_LIBRARY_PACK_NAME,
          label: PUBLISHED_LIBRARY_LABEL,
          type: "Item",
          system: game.system.id
        });
      } catch (error) {
        // Multiple GM clients can reach ready at nearly the same time. If the
        // other client created the pack first, resolve that canonical pack.
        pack = this.getPack();
        if (!pack) throw error;
      }
    }
    if (!pack) throw new Error("Item Creator could not create or resolve its Published Items compendium.");
    const restoreLock = Boolean(pack.locked && !unlock);
    if (pack.locked) await pack.configure({ locked: false });

    try {
      await this.#ensureSidebarFolder(pack);
      const folders = await this.#ensureInternalFolders(pack);
      if (organize) await this.#organizeExistingDocuments(pack, folders);
    } finally {
      if (restoreLock) await pack.configure({ locked: true });
    }
    return pack;
  }

  static async #ensureSidebarFolder(pack) {
    let folder = game.packs?.folders?.find?.(entry => isSidebarLibraryFolder(entry))
      ?? game.packs?.folders?.find?.(entry => entry?.name === PUBLISHED_LIBRARY_SIDEBAR_FOLDER)
      ?? null;

    if (!folder) {
      const FolderClass = Folder.implementation ?? CONFIG.Folder.documentClass ?? Folder;
      folder = await FolderClass.create({
        name: PUBLISHED_LIBRARY_SIDEBAR_FOLDER,
        type: "Compendium",
        sorting: "a",
        flags: { [MODULE_ID]: { publishedLibraryRoot: true } }
      }, { render: false });
    } else if (!isSidebarLibraryFolder(folder)) {
      await folder.update({ [`flags.${MODULE_ID}.publishedLibraryRoot`]: true }, { render: false });
    }

    if (folder && pack && pack.folder?.id !== folder.id) await pack.setFolder(folder);
    return folder;
  }

  static async #ensureInternalFolders(pack) {
    const FolderClass = Folder.implementation ?? CONFIG.Folder.documentClass ?? Folder;
    const resolved = new Map();
    const existing = [...(pack.folders?.values?.() ?? [])];

    for (const definition of LIBRARY_FOLDER_DEFINITIONS) {
      const parentId = definition.parent ? resolved.get(definition.parent)?.id ?? null : null;
      let folder = existing.find(entry => folderFlag(entry)?.key === definition.key)
        ?? existing.find(entry => entry.name === definition.label && (entry.folder?.id ?? entry._source?.folder ?? null) === parentId)
        ?? null;

      if (!folder) {
        folder = await FolderClass.create({
          name: definition.label,
          type: "Item",
          folder: parentId,
          sorting: "a",
          sort: definition.order * 100000,
          flags: { [MODULE_ID]: { publishedLibraryFolder: { key: definition.key } } }
        }, { pack: pack.collection, render: false });
        existing.push(folder);
      } else {
        const updates = {};
        if (folderFlag(folder)?.key !== definition.key) updates[`flags.${MODULE_ID}.publishedLibraryFolder`] = { key: definition.key };
        if ((folder.folder?.id ?? folder._source?.folder ?? null) !== parentId) updates.folder = parentId;
        if (folder.sorting !== "a") updates.sorting = "a";
        if (Object.keys(updates).length) await folder.update(updates, { render: false });
      }
      resolved.set(definition.key, folder);
    }
    return resolved;
  }

  static async #organizeExistingDocuments(pack, folders) {
    const documents = await pack.getDocuments();
    let changed = false;
    for (const item of documents) {
      const target = folders.get(libraryFolderKeyForItem(item)) ?? folders.get("other");
      if (!target) continue;
      const currentFolderId = item.folder?.id ?? item._source?.folder ?? null;
      if (currentFolderId === target.id) continue;
      await item.update({ folder: target.id }, { render: false });
      changed = true;
    }
    // Foundry document updates refresh open directory views on their own. Do not
    // call pack.render() here: CompendiumCollection#render opens the pack UI and
    // would steal focus during background organization/publication workflows.
  }

  static async canonicalFolderId(itemData, { pack = null } = {}) {
    pack ??= await this.ensurePack({ unlock: true, organize: false });
    const folders = await this.#ensureInternalFolders(pack);
    return folders.get(libraryFolderKeyForItem(itemData))?.id ?? folders.get("other")?.id ?? null;
  }

  static isLibraryItem(item) {
    return Boolean(item?.documentName === "Item" && item?.pack === collectionId());
  }

  static isPublishedItem(item) {
    return Boolean(this.isLibraryItem(item) && publicationFlag(item)?.id);
  }

  static publication(item) {
    return clone(publicationFlag(item) ?? {});
  }

  static category(item) {
    return categoryForItem(item);
  }

  static folderKey(item) {
    return libraryFolderKeyForItem(item);
  }

  static async getDocuments({ includeArchived = true } = {}) {
    const pack = await this.ensurePack();
    const documents = await pack.getDocuments();
    return documents.filter(item => publicationFlag(item)?.id
      && (includeArchived || publicationFlag(item)?.status !== "archived"));
  }

  static async list({ includeArchived = false, search = "", type = "all" } = {}) {
    const query = String(search ?? "").trim().toLowerCase();
    const documents = await this.getDocuments({ includeArchived: true });
    const rows = documents.map(item => {
      const publication = publicationFlag(item) ?? {};
      const category = categoryForItem(item);
      const folderKey = libraryFolderKeyForItem(item);
      const folder = folderDefinition(folderKey);
      const rarity = Array.isArray(item.system?.rarities) ? item.system.rarities[0] ?? "" : item.system?.rarity ?? "";
      const subtype = item.system?.type?.value ?? item.system?.type ?? "";
      return {
        id: item.id,
        uuid: item.uuid,
        name: item.name,
        img: item.img,
        type: item.type,
        subtype: typeof subtype === "string" ? subtype : "",
        rarity: String(rarity ?? ""),
        category,
        categoryLabel: categoryLabel(category),
        folderKey,
        folderLabel: folder?.label ?? "Other / Uncategorized",
        publicationId: publication.id ?? "",
        revision: Math.max(1, Number(publication.revision) || 1),
        status: publication.status === "archived" ? "archived" : "published",
        archived: publication.status === "archived",
        updatedAt: Number(publication.updatedAt) || Number(publication.publishedAt) || 0,
        searchText: `${item.name} ${item.type} ${subtype} ${rarity} ${folder?.label ?? ""}`.toLowerCase()
      };
    }).filter(row => (includeArchived || !row.archived)
      && (type === "all" || row.category === type)
      && (!query || row.searchText.includes(query)));

    rows.sort((a, b) => a.folderLabel.localeCompare(b.folderLabel) || a.name.localeCompare(b.name));
    return rows;
  }

  static displayTree(rows) {
    return buildDisplayTree(rows);
  }

  static prepareNewPublicationData(data, { sourceItem = null, copiedFrom = null } = {}) {
    const prepared = sanitizeForCompendium(data);
    prepared.flags ??= {};
    prepared.flags[MODULE_ID] ??= {};
    delete prepared.flags[MODULE_ID].publicationSource;
    prepared.flags[MODULE_ID].publication = {
      id: foundry.utils.randomID(),
      revision: 1,
      status: "published",
      publishedAt: now(),
      updatedAt: now(),
      sourceWorldUuid: sourceItem && !sourceItem.pack ? sourceItem.uuid : null,
      copiedFrom: copiedFrom ? {
        publicationId: publicationFlag(copiedFrom)?.id ?? null,
        uuid: copiedFrom.uuid ?? null,
        revision: Math.max(1, Number(publicationFlag(copiedFrom)?.revision) || 1)
      } : null
    };
    return prepared;
  }

  static preparePublishedUpdateData(item, data) {
    if (!this.isPublishedItem(item)) throw new Error("The selected Item is not an Item Creator publication.");
    const prepared = sanitizeForCompendium(data);
    const current = publicationFlag(item) ?? {};
    prepared.flags ??= {};
    prepared.flags[MODULE_ID] ??= {};
    delete prepared.flags[MODULE_ID].publicationSource;
    prepared.flags[MODULE_ID].publication = {
      ...clone(current),
      id: current.id || foundry.utils.randomID(),
      revision: Math.max(1, Number(current.revision) || 1) + 1,
      status: current.status === "archived" ? "archived" : "published",
      publishedAt: Number(current.publishedAt) || now(),
      updatedAt: now()
    };
    return prepared;
  }

  static async createPublished(data, options = {}) {
    const pack = await this.ensurePack({ unlock: true });
    const prepared = this.prepareNewPublicationData(data, options);
    prepared.folder = await this.canonicalFolderId(prepared, { pack });
    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    const created = await ItemClass.create(prepared, { pack: pack.collection, renderSheet: false });
    if (!created) throw new Error("Foundry did not return the published Item document.");
    return created;
  }

  static async preparePublishedUpdate(item, data) {
    const pack = await this.ensurePack({ unlock: true, organize: false });
    const prepared = this.preparePublishedUpdateData(item, data);
    prepared.folder = await this.canonicalFolderId(prepared, { pack });
    return prepared;
  }

  static async setArchived(item, archived = true) {
    if (!this.isPublishedItem(item)) throw new Error("Only Item Creator published Items can be archived here.");
    const pack = await this.ensurePack({ unlock: true });
    const publication = publicationFlag(item) ?? {};
    await item.update({
      [`flags.${MODULE_ID}.publication`]: {
        ...clone(publication),
        id: publication.id || foundry.utils.randomID(),
        revision: Math.max(1, Number(publication.revision) || 1),
        status: archived ? "archived" : "published",
        updatedAt: now()
      }
    });
    return item;
  }

  static async deletePublished(item) {
    if (!this.isPublishedItem(item)) throw new Error("Only Item Creator published Items can be deleted here.");
    const pack = await this.ensurePack({ unlock: true });
    await item.delete();
  }

  static async createWorldCopy(item) {
    if (!this.isPublishedItem(item)) throw new Error("Only Item Creator published Items can be copied to the World from this library.");
    const source = clone(item.toObject());
    delete source._id;
    delete source._stats;
    delete source.folder;
    delete source.sort;
    source.ownership = { default: 0 };
    source.flags ??= {};
    source.flags[MODULE_ID] ??= {};
    const publication = publicationFlag(item) ?? {};
    delete source.flags[MODULE_ID].publication;
    source.flags[MODULE_ID].publicationSource = {
      uuid: item.uuid,
      publicationId: publication.id ?? null,
      revision: Math.max(1, Number(publication.revision) || 1)
    };
    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    return ItemClass.create(source, { renderSheet: false });
  }
}
