import { MODULE_ID } from "../constants.mjs";

export const PUBLISHED_LIBRARY_PACK_NAME = "item-creator-published-items";
export const PUBLISHED_LIBRARY_LABEL = "Item Creator — Published Items";

const CATEGORY_DEFINITIONS = Object.freeze([
  { id: "weapon", label: "Weapons", icon: "fa-khanda", types: ["weapon"] },
  { id: "equipment", label: "Equipment", icon: "fa-shield-halved", types: ["equipment"] },
  { id: "consumable", label: "Consumables", icon: "fa-flask", types: ["consumable"] },
  { id: "tool", label: "Tools", icon: "fa-hammer", types: ["tool"] },
  { id: "other", label: "Other", icon: "fa-box", types: [] }
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

function sanitizeForCompendium(data) {
  const source = clone(data ?? {});
  delete source._id;
  delete source._stats;
  delete source.sort;
  delete source.ownership;
  source.folder = null;
  return source;
}

export class PublishedItemLibraryService {
  static get packId() { return collectionId(); }
  static get categories() { return CATEGORY_DEFINITIONS; }

  static getPack() {
    return game.packs.get(collectionId())
      ?? game.packs.find(pack => pack?.collection === collectionId())
      ?? null;
  }

  static async ensurePack({ unlock = false } = {}) {
    if (!game.user?.isGM) throw new Error("Only a GM can manage the Item Creator Published Library.");
    let pack = this.getPack();
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
    if (unlock && pack.locked) await pack.configure({ locked: false });
    return pack;
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
        publicationId: publication.id ?? "",
        revision: Math.max(1, Number(publication.revision) || 1),
        status: publication.status === "archived" ? "archived" : "published",
        archived: publication.status === "archived",
        updatedAt: Number(publication.updatedAt) || Number(publication.publishedAt) || 0,
        searchText: `${item.name} ${item.type} ${subtype} ${rarity}`.toLowerCase()
      };
    }).filter(row => (includeArchived || !row.archived)
      && (type === "all" || row.category === type)
      && (!query || row.searchText.includes(query)));

    rows.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return rows;
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
    prepared.folder = item.folder?.id ?? item._source?.folder ?? null;
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
    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    const created = await ItemClass.create(prepared, { pack: pack.collection, renderSheet: false });
    if (!created) throw new Error("Foundry did not return the published Item document.");
    pack.render?.(true);
    return created;
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
    pack.render?.(true);
    return item;
  }

  static async deletePublished(item) {
    if (!this.isPublishedItem(item)) throw new Error("Only Item Creator published Items can be deleted here.");
    const pack = await this.ensurePack({ unlock: true });
    await item.delete();
    pack.render?.(true);
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
