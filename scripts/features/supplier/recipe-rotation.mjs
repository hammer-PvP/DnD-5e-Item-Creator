/**
 * Supplier Knowledge rotation (v0.8.3).
 * Pure helpers: no Foundry state, no compendium access, no document mutation.
 * A category gets one lottery ticket according to its Profile weight, regardless
 * of how many curated documents that category contains. When alternatives are
 * available, prefer category diversity before repeating a category.
 */

export function curatedKnowledgeCategory(entry) {
  const kind = String(entry?.craftingCuratedKind ?? "");
  const category = String(entry?.craftingProductCategory ?? "").trim().toLowerCase();
  const subcategory = String(entry?.craftingProductSubcategory ?? "").trim().toLowerCase();
  if (kind === "equipment-recipe") {
    if (["weapon", "armor", "shield", "ammunition"].includes(subcategory)) return subcategory;
    // Use the Product's declared category if the older Learn Source omitted its
    // subcategory. Product metadata enrichment runs before this classification.
    if (["weapon", "armor", "shield", "ammunition"].includes(category)) return category;
    return "other";
  }
  if (kind === "alchemy-recipe") {
    if (category === "inscription" || subcategory.startsWith("inscription")) return "inscription";
    return "alchemy";
  }
  if (kind === "culinary-recipe") return "culinary";
  return "other";
}

export function knowledgeCategoryCounts(entries, categoryOf = curatedKnowledgeCategory) {
  const counts = {};
  for (const entry of entries ?? []) {
    const key = categoryOf(entry);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Single knowledge-selection policy for any Profile using the curated pool.
 * - A new category is preferred over a previously chosen one, when possible.
 * - Ammunition is not given one slot per ammo family, enhancement or source.
 * - An individual Recipe identity can never be selected twice.
 * - When a Profile deliberately enables only one category, it can still use
 *   its configured number of slots (no artificial empty stock).
 */
export function rotateCuratedKnowledge(entries, requested, {
  categoryOf = curatedKnowledgeCategory,
  categoryWeight = () => 1,
  chooseWithinCategory,
  identityOf,
  random = Math.random
} = {}) {
  let available = [...(entries ?? [])];
  const selected = [];
  const categoryPicks = {};
  const iterations = [];
  const limit = Math.max(0, Math.floor(Number(requested) || 0));
  const getIdentity = identityOf ?? (entry => String(entry?.uuid ?? entry?.craftingKnowledgeRecipeId ?? entry?.name ?? ""));
  for (let index = 0; index < limit && available.length; index += 1) {
    const buckets = new Map();
    for (const entry of available) {
      const category = categoryOf(entry);
      if (!buckets.has(category)) buckets.set(category, []);
      buckets.get(category).push(entry);
    }
    let options = [...buckets].map(([category, items]) => ({
      category, items, weight: Math.max(0, Number(categoryWeight(category)) || 0)
    })).filter(option => option.items.length > 0 && option.weight > 0);
    if (!options.length) break;
    // First choose from categories that have not yet received a slot. This is
    // conditional on their actual eligibility, not hard-coded vendor names.
    const unused = options.filter(option => !categoryPicks[option.category]);
    if (unused.length) options = unused;
    const sum = options.reduce((total, option) => total + option.weight, 0);
    let ticket = Math.max(0, Math.min(0.999999999999, Number(random()) || 0)) * sum;
    let selectedCategory = options.at(-1);
    for (const option of options) {
      ticket -= option.weight;
      if (ticket < 0) { selectedCategory = option; break; }
    }
    const entry = chooseWithinCategory?.(selectedCategory.items) ?? selectedCategory.items[0];
    if (!entry) break;
    const key = getIdentity(entry);
    selected.push(entry);
    categoryPicks[selectedCategory.category] = (categoryPicks[selectedCategory.category] ?? 0) + 1;
    iterations.push({
      slot: selected.length,
      category: selectedCategory.category,
      item: String(entry.name ?? ""),
      identity: key,
      categoriesAvailable: [...buckets.keys()],
      categoryWeightsApplied: Object.fromEntries(options.map(option => [option.category, option.weight]))
    });
    available = available.filter(candidate => getIdentity(candidate) !== key);
  }
  return { selected, categoryPicks, iterations };
}
