import { MODULE_ID } from "../constants.mjs";
import { normalizeDnd6ItemSource, normalizeDnd5eIdentifier } from "../utils/dnd6-compat.mjs";
import { PUBLISHED_LIBRARY_SIDEBAR_FOLDER } from "./published-item-library-service.mjs";

export const PUBLISHED_SPELL_PACK_NAME = "item-creator-published-spells";
export const PUBLISHED_SPELL_PACK_LABEL = "Item Creator — Published Spells";
export const SPELL_DRAFT_PACK_NAME = "item-creator-spell-drafts";
export const SPELL_DRAFT_PACK_LABEL = "Item Creator — Spell Drafts (Internal)";
export const ITEM_CREATOR_FOLDER_COLOR = "#2f5335";

const SCHOOL_DEFINITIONS = Object.freeze([
  { key: "abj", label: "Abjuration", icon: "fa-shield", school: "abj", order: 10 },
  { key: "con", label: "Conjuration", icon: "fa-sparkles", school: "con", order: 20 },
  { key: "div", label: "Divination", icon: "fa-eye", school: "div", order: 30 },
  { key: "enc", label: "Enchantment", icon: "fa-wand-magic-sparkles", school: "enc", order: 40 },
  { key: "evo", label: "Evocation", icon: "fa-burst", school: "evo", order: 50 },
  { key: "ill", label: "Illusion", icon: "fa-masks-theater", school: "ill", order: 60 },
  { key: "nec", label: "Necromancy", icon: "fa-skull", school: "nec", order: 70 },
  { key: "trs", label: "Transmutation", icon: "fa-arrows-rotate", school: "trs", order: 80 },
  { key: "other", label: "Other / Unclassified", icon: "fa-circle-question", school: "", order: 90 }
]);

function clone(value) {
  return foundry.utils.deepClone(value);
}

function valuesOf(value) {
  if (value instanceof Map) return [...value.values()];
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value;
  if (value?.values instanceof Function) {
    try { return [...value.values()]; } catch (_error) { /* fall through */ }
  }
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function now() {
  return Date.now();
}

function publishedCollectionId() {
  return `world.${PUBLISHED_SPELL_PACK_NAME}`;
}

function draftCollectionId() {
  return `world.${SPELL_DRAFT_PACK_NAME}`;
}

function publicationFlag(item) {
  return item?.flags?.[MODULE_ID]?.publication ?? null;
}

function spellFactoryFlag(item) {
  return item?.flags?.[MODULE_ID]?.spellFactory ?? null;
}

function folderFlag(folder) {
  return folder?.flags?.[MODULE_ID]?.publishedSpellFolder ?? null;
}

function isSidebarLibraryFolder(folder) {
  return Boolean(folder?.flags?.[MODULE_ID]?.publishedLibraryRoot);
}

function sanitizeSource(data) {
  const source = clone(data ?? {});
  delete source._id;
  delete source._stats;
  delete source.sort;
  delete source.ownership;
  source.folder = null;
  source.type = "spell";
  source.flags ??= {};
  source.flags[MODULE_ID] ??= {};
  delete source.flags[MODULE_ID].publication;
  delete source.flags[MODULE_ID].publicationSource;
  return normalizeDnd6ItemSource(source);
}

function schoolKey(item) {
  const school = String(item?.system?.school ?? "").trim();
  return SCHOOL_DEFINITIONS.some(def => def.school === school) ? school : "other";
}

function schoolLabel(key) {
  return SCHOOL_DEFINITIONS.find(def => def.key === key)?.label ?? "Other / Unclassified";
}

function classListsFromDocument(item) {
  const fromFlag = spellFactoryFlag(item)?.classLists;
  if (Array.isArray(fromFlag)) return [...new Set(fromFlag.map(String).filter(Boolean))];
  const lists = item?.system?.spellLists;
  const values = lists instanceof Set ? [...lists] : Array.isArray(lists) ? lists : [];
  return [...new Set(values.map(value => String(value)).filter(value => value.startsWith("class:")).map(value => value.slice(6)))];
}

function defaultBlankSpellSource() {
  // Keep the blank source intentionally sparse. Spell5e owns defaults for
  // activation, duration, range, target, materials, description, and the
  // native Activities collection; this avoids duplicating system schema here.
  return {
    name: "New Spell",
    type: "spell",
    img: "icons/magic/symbols/runes-star-pentagon-blue.webp",
    system: {
      level: 1,
      school: "evo",
      method: "spell",
      prepared: 0,
      properties: [],
      identifier: "new-spell",
      activities: {}
    },
    effects: [],
    flags: {}
  };
}

function buildTree(rows) {
  return SCHOOL_DEFINITIONS.map(def => ({
    ...def,
    items: rows.filter(row => row.schoolKey === def.key).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, game.i18n.lang)),
    count: rows.filter(row => row.schoolKey === def.key).length
  })).filter(group => group.count > 0);
}

export class PublishedSpellLibraryService {
  static get packId() { return publishedCollectionId(); }
  static get draftPackId() { return draftCollectionId(); }
  static get schools() { return SCHOOL_DEFINITIONS; }

  static getPack() {
    return game.packs.get(publishedCollectionId())
      ?? game.packs.find(pack => pack?.collection === publishedCollectionId())
      ?? null;
  }

  static getDraftPack() {
    return game.packs.get(draftCollectionId())
      ?? game.packs.find(pack => pack?.collection === draftCollectionId())
      ?? null;
  }

  static async #ensureSidebarFolder(pack) {
    let folder = game.packs?.folders?.find?.(entry => isSidebarLibraryFolder(entry))
      ?? game.packs?.folders?.find?.(entry => entry?.name === PUBLISHED_LIBRARY_SIDEBAR_FOLDER)
      ?? null;
    const FolderClass = Folder.implementation ?? CONFIG.Folder.documentClass ?? Folder;
    if (!folder) {
      folder = await FolderClass.create({
        name: PUBLISHED_LIBRARY_SIDEBAR_FOLDER,
        type: "Compendium",
        sorting: "a",
        color: ITEM_CREATOR_FOLDER_COLOR,
        flags: { [MODULE_ID]: { publishedLibraryRoot: true } }
      }, { render: false });
    } else {
      const updates = {};
      if (!isSidebarLibraryFolder(folder)) updates[`flags.${MODULE_ID}.publishedLibraryRoot`] = true;
      if (folder.color !== ITEM_CREATOR_FOLDER_COLOR) updates.color = ITEM_CREATOR_FOLDER_COLOR;
      if (Object.keys(updates).length) await folder.update(updates, { render: false });
    }
    if (folder && pack && pack.folder?.id !== folder.id) await pack.setFolder(folder);
    return folder;
  }

  static async #createPack(name, label) {
    const CompendiumCollection = foundry.documents.collections.CompendiumCollection;
    return CompendiumCollection.createCompendium({ name, label, type: "Item", system: game.system.id });
  }

  static async #excludeDraftPackFromNativeBrowser(pack) {
    if (!pack?.collection || !game.settings?.get || !game.settings?.set) return;
    let current;
    try { current = game.settings.get("dnd5e", "packSourceConfiguration") ?? {}; }
    catch (_error) { return; }
    if (current?.[pack.collection] === false) return;
    try {
      await game.settings.set("dnd5e", "packSourceConfiguration", { ...current, [pack.collection]: false });
    } catch (error) {
      console.warn(`${MODULE_ID} | Unable to exclude internal Spell drafts from the native D&D5e Compendium Browser.`, error);
    }
  }

  static async ensurePack({ unlock = false, organize = true } = {}) {
    if (!game.user?.isGM) throw new Error("Only a GM can manage the Item Creator Published Spells library.");
    let pack = this.getPack();
    if (!pack) await this.#ensureSidebarFolder(null);
    if (!pack) {
      try { pack = await this.#createPack(PUBLISHED_SPELL_PACK_NAME, PUBLISHED_SPELL_PACK_LABEL); }
      catch (error) { pack = this.getPack(); if (!pack) throw error; }
    }
    if (!pack) throw new Error("Item Creator could not create or resolve its Published Spells compendium.");
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

  static async ensureDraftPack({ unlock = true } = {}) {
    if (!game.user?.isGM) throw new Error("Only a GM can manage Spell Factory drafts.");
    let pack = this.getDraftPack();
    if (!pack) await this.#ensureSidebarFolder(null);
    if (!pack) {
      try { pack = await this.#createPack(SPELL_DRAFT_PACK_NAME, SPELL_DRAFT_PACK_LABEL); }
      catch (error) { pack = this.getDraftPack(); if (!pack) throw error; }
    }
    if (!pack) throw new Error("Item Creator could not create or resolve its Spell Draft compendium.");
    if (pack.locked && unlock) await pack.configure({ locked: false });
    await this.#ensureSidebarFolder(pack);
    await this.#excludeDraftPackFromNativeBrowser(pack);
    return pack;
  }

  static async #ensureInternalFolders(pack) {
    const FolderClass = Folder.implementation ?? CONFIG.Folder.documentClass ?? Folder;
    const resolved = new Map();
    const existing = [...(pack.folders?.values?.() ?? [])];
    for (const definition of SCHOOL_DEFINITIONS) {
      let folder = existing.find(entry => folderFlag(entry)?.key === definition.key)
        ?? existing.find(entry => entry.name === definition.label && !(entry.folder?.id ?? entry._source?.folder))
        ?? null;
      if (!folder) {
        folder = await FolderClass.create({
          name: definition.label,
          type: "Item",
          folder: null,
          sorting: "a",
          sort: definition.order * 100000,
          flags: { [MODULE_ID]: { publishedSpellFolder: { key: definition.key } } }
        }, { pack: pack.collection, render: false });
        existing.push(folder);
      } else {
        const updates = {};
        if (folderFlag(folder)?.key !== definition.key) updates[`flags.${MODULE_ID}.publishedSpellFolder`] = { key: definition.key };
        if (folder.sorting !== "a") updates.sorting = "a";
        if (Object.keys(updates).length) await folder.update(updates, { render: false });
      }
      resolved.set(definition.key, folder);
    }
    return resolved;
  }

  static async #organizeExistingDocuments(pack, folders) {
    const documents = await pack.getDocuments();
    for (const spell of documents) {
      if (spell.type !== "spell") continue;
      const target = folders.get(schoolKey(spell)) ?? folders.get("other");
      if (!target) continue;
      const current = spell.folder?.id ?? spell._source?.folder ?? null;
      if (current !== target.id) await spell.update({ folder: target.id }, { render: false });
    }
  }

  static async folderIdFor(spell, { pack = null } = {}) {
    pack ??= await this.ensurePack({ unlock: true, organize: false });
    const folders = await this.#ensureInternalFolders(pack);
    return folders.get(schoolKey(spell))?.id ?? folders.get("other")?.id ?? null;
  }

  static isLibrarySpell(item) {
    return Boolean(item?.documentName === "Item" && item?.type === "spell" && item?.pack === publishedCollectionId());
  }

  static isDraft(item) {
    return Boolean(item?.documentName === "Item" && item?.type === "spell" && item?.pack === draftCollectionId() && spellFactoryFlag(item)?.state === "draft");
  }

  static isPublished(item) {
    return Boolean(this.isLibrarySpell(item) && publicationFlag(item)?.kind === "spell" && publicationFlag(item)?.id);
  }

  static classLists(item) {
    return classListsFromDocument(item);
  }

  static async createBlankDraft() {
    return this.#createDraft(defaultBlankSpellSource(), { sourceSpell: null, editingPublished: null });
  }

  static async createDraftFromSpell(sourceSpell, { editPublished = false } = {}) {
    if (!sourceSpell || sourceSpell.type !== "spell") throw new Error("Spell Factory requires a Spell Item blueprint.");
    return this.#createDraft(sourceSpell.toObject ? sourceSpell.toObject() : sourceSpell, {
      sourceSpell,
      editingPublished: editPublished && this.isPublished(sourceSpell) ? sourceSpell : null
    });
  }

  static async #createDraft(sourceData, { sourceSpell = null, editingPublished = null } = {}) {
    const pack = await this.ensureDraftPack({ unlock: true });
    const prepared = sanitizeSource(sourceData);
    const sourceName = String(sourceSpell?.name ?? prepared.name ?? "Spell");
    if (!editingPublished && sourceSpell) prepared.name = `${sourceName} Copy`;
    prepared.system ??= {};
    const originalIdentifier = normalizeDnd5eIdentifier(prepared.system.identifier, { fallback: sourceName });
    prepared.system.identifier = normalizeDnd5eIdentifier(prepared.name, { fallback: originalIdentifier || "new-spell" });
    prepared.flags ??= {};
    prepared.flags[MODULE_ID] ??= {};
    prepared.flags[MODULE_ID].spellFactory = {
      schemaVersion: 1,
      state: "draft",
      classLists: classListsFromDocument(sourceSpell),
      sourceUuid: sourceSpell?.uuid ?? null,
      sourceName: sourceSpell?.name ?? null,
      createdAt: now(),
      updatedAt: now(),
      initialName: prepared.name,
      initialIdentifier: prepared.system.identifier,
      editingPublication: editingPublished ? {
        uuid: editingPublished.uuid,
        id: editingPublished.id,
        publicationId: publicationFlag(editingPublished)?.id ?? null,
        revision: Math.max(1, Number(publicationFlag(editingPublished)?.revision) || 1)
      } : null
    };
    prepared.folder = null;
    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    const created = await ItemClass.create(prepared, { pack: pack.collection, renderSheet: false, keepEmbeddedIds: true });
    if (!created) throw new Error("Foundry did not return the Spell Factory draft document.");
    return created;
  }

  static async getDraft(id) {
    const pack = this.getDraftPack();
    if (!pack) return null;
    const spell = await pack.getDocument(id);
    return this.isDraft(spell) ? spell : null;
  }

  static async listDrafts() {
    const pack = this.getDraftPack();
    if (!pack) return [];
    const docs = await pack.getDocuments();
    return docs.filter(spell => this.isDraft(spell)).map(spell => {
      const flag = spellFactoryFlag(spell) ?? {};
      return {
        id: spell.id,
        uuid: spell.uuid,
        name: spell.name,
        img: spell.img,
        level: Number(spell.system?.level) || 0,
        school: String(spell.system?.school ?? ""),
        sourceName: flag.sourceName ?? "Blank Spell",
        editing: Boolean(flag.editingPublication),
        updatedAt: Number(spell._stats?.modifiedTime) || Number(flag.updatedAt) || Number(flag.createdAt) || 0
      };
    }).sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, game.i18n.lang));
  }

  static async setClassLists(draft, classLists = []) {
    if (!this.isDraft(draft)) throw new Error("Class-list changes can only be applied to a Spell Factory draft.");
    const values = [...new Set(classLists.map(String).filter(Boolean))];
    const current = spellFactoryFlag(draft) ?? {};
    await draft.update({ [`flags.${MODULE_ID}.spellFactory`]: { ...clone(current), classLists: values, updatedAt: now() } }, { render: false });
    return values;
  }

  static async publishDraft(draft) {
    if (!this.isDraft(draft)) throw new Error("Only a Spell Factory draft can be published.");
    const factory = spellFactoryFlag(draft) ?? {};
    if (factory.editingPublication?.id) return this.#updatePublicationFromDraft(draft, factory.editingPublication);
    return this.#publishNewDraft(draft);
  }

  static #preparePublishedSourceFromDraft(draft, { publication = null } = {}) {
    const source = sanitizeSource(draft.toObject());
    const factory = clone(spellFactoryFlag(draft) ?? {});
    const systemIdentifier = normalizeDnd5eIdentifier(source.system?.identifier, { fallback: source.name });
    const initialIdentifier = normalizeDnd5eIdentifier(factory.initialIdentifier);
    if (!publication && (!systemIdentifier || systemIdentifier === initialIdentifier)) {
      source.system.identifier = normalizeDnd5eIdentifier(source.name, { fallback: "homebrew-spell" });
    } else source.system.identifier = systemIdentifier || normalizeDnd5eIdentifier(source.name, { fallback: "homebrew-spell" });
    factory.state = publication?.status === "archived" ? "archived" : "published";
    factory.updatedAt = now();
    delete factory.editingPublication;
    source.flags ??= {};
    source.flags[MODULE_ID] ??= {};
    source.flags[MODULE_ID].spellFactory = factory;
    return source;
  }

  static async #publishNewDraft(draft) {
    const classLists = classListsFromDocument(draft);
    if (!classLists.length) throw new Error("Choose at least one class spell list before publishing.");
    const pack = await this.ensurePack({ unlock: true, organize: false });
    const source = this.#preparePublishedSourceFromDraft(draft);
    source.flags[MODULE_ID].publication = {
      kind: "spell",
      id: foundry.utils.randomID(),
      revision: 1,
      status: "published",
      publishedAt: now(),
      updatedAt: now(),
      sourceUuid: spellFactoryFlag(draft)?.sourceUuid ?? null
    };
    source.folder = await this.folderIdFor(source, { pack });
    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    const published = await ItemClass.create(source, { pack: pack.collection, renderSheet: false, keepEmbeddedIds: true });
    if (!published) throw new Error("Foundry did not return the Published Spell document.");
    await draft.delete();
    return published;
  }

  static async #updatePublicationFromDraft(draft, editing) {
    const classLists = classListsFromDocument(draft);
    if (!classLists.length) throw new Error("Choose at least one class spell list before updating the publication.");
    const pack = await this.ensurePack({ unlock: true, organize: false });
    const target = await pack.getDocument(editing.id);
    if (!this.isPublished(target)) throw new Error("The original Published Spell is no longer available.");

    const currentPublication = publicationFlag(target) ?? {};
    const source = this.#preparePublishedSourceFromDraft(draft, { publication: currentPublication });
    source.flags[MODULE_ID].publication = {
      ...clone(currentPublication),
      kind: "spell",
      id: currentPublication.id || editing.publicationId || foundry.utils.randomID(),
      revision: Math.max(1, Number(currentPublication.revision) || Number(editing.revision) || 1) + 1,
      status: currentPublication.status === "archived" ? "archived" : "published",
      publishedAt: Number(currentPublication.publishedAt) || now(),
      updatedAt: now()
    };
    source.folder = await this.folderIdFor(source, { pack });

    const rollback = clone(target.toObject());
    const desiredEffects = clone(source.effects ?? []);
    const desiredActivities = clone(source.system?.activities ?? {});
    const updateData = clone(source);
    delete updateData._id;
    delete updateData.effects;
    if (updateData.system) delete updateData.system.activities;

    const replaceActivities = async activities => {
      const currentIds = valuesOf(target.system?.activities).map(activity => activity?.id ?? activity?._id).filter(Boolean);
      if (currentIds.length) {
        const deletions = {};
        for (const id of currentIds) deletions[`system.activities.-=${id}`] = null;
        await target.update(deletions, { render: false });
      }
      if (activities && Object.keys(activities).length) await target.update({ "system.activities": clone(activities) }, { render: false });
    };
    const replaceEffects = async effects => {
      const ids = valuesOf(target.effects).map(effect => effect.id).filter(Boolean);
      if (ids.length) await target.deleteEmbeddedDocuments("ActiveEffect", ids);
      if (effects?.length) await target.createEmbeddedDocuments("ActiveEffect", clone(effects), { keepId: true });
    };

    try {
      await target.update(updateData, { diff: false, render: false });
      await replaceActivities(desiredActivities);
      await replaceEffects(desiredEffects);
    } catch (error) {
      try {
        const rollbackData = clone(rollback);
        const rollbackEffects = clone(rollbackData.effects ?? []);
        const rollbackActivities = clone(rollbackData.system?.activities ?? {});
        delete rollbackData._id;
        delete rollbackData.effects;
        if (rollbackData.system) delete rollbackData.system.activities;
        await target.update(rollbackData, { diff: false, render: false });
        await replaceActivities(rollbackActivities);
        await replaceEffects(rollbackEffects);
      } catch (rollbackError) {
        console.error(`${MODULE_ID} | Published Spell rollback failed after update error.`, rollbackError);
      }
      throw error;
    }

    await draft.delete();
    return target;
  }

  static async discardDraft(draft) {
    if (!this.isDraft(draft)) throw new Error("Only Spell Factory drafts can be discarded.");
    await draft.delete();
  }

  static async setArchived(spell, archived = true) {
    if (!this.isPublished(spell)) throw new Error("Only Item Creator Published Spells can be archived here.");
    const publication = publicationFlag(spell) ?? {};
    const factory = spellFactoryFlag(spell) ?? {};
    await spell.update({
      [`flags.${MODULE_ID}.publication`]: { ...clone(publication), status: archived ? "archived" : "published", updatedAt: now() },
      [`flags.${MODULE_ID}.spellFactory`]: { ...clone(factory), state: archived ? "archived" : "published", updatedAt: now() }
    }, { render: false });
    return spell;
  }

  static async deletePublished(spell) {
    if (!this.isPublished(spell)) throw new Error("Only Item Creator Published Spells can be deleted here.");
    await spell.delete();
  }

  static async list({ includeArchived = false, search = "", school = "all" } = {}) {
    const pack = await this.ensurePack();
    const docs = await pack.getDocuments();
    const query = String(search ?? "").trim().toLowerCase();
    const rows = docs.filter(spell => this.isPublished(spell)).map(spell => {
      const publication = publicationFlag(spell) ?? {};
      const key = schoolKey(spell);
      const classLists = classListsFromDocument(spell);
      const level = Number(spell.system?.level) || 0;
      const archived = publication.status === "archived";
      return {
        id: spell.id,
        uuid: spell.uuid,
        name: spell.name,
        img: spell.img,
        identifier: spell.system?.identifier ?? "",
        schoolKey: key,
        schoolLabel: schoolLabel(key),
        level,
        levelLabel: level === 0 ? "Cantrip" : `Level ${level}`,
        classLists,
        classLabel: classLists.join(", "),
        revision: Math.max(1, Number(publication.revision) || 1),
        archived,
        status: archived ? "archived" : "published",
        searchText: `${spell.name} ${spell.system?.identifier ?? ""} ${schoolLabel(key)} ${level} ${classLists.join(" ")}`.toLowerCase()
      };
    }).filter(row => (includeArchived || !row.archived)
      && (school === "all" || row.schoolKey === school)
      && (!query || row.searchText.includes(query)));
    return rows.sort((a, b) => a.schoolLabel.localeCompare(b.schoolLabel) || a.level - b.level || a.name.localeCompare(b.name));
  }

  static displayTree(rows) {
    return buildTree(rows);
  }
}
