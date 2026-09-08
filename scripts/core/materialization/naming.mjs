/**
 * Canonical naming helpers for concrete Items produced by materializers.
 * The functions are deterministic and idempotent: feeding an already
 * materialized name through them again returns the same name.
 */

function normalizedToken(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9+]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanSpacing(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .trim();
}

function tokenKey(value) {
  return normalizedToken(value).replace(/^-+|-+$/g, "");
}

/** Remove a repeated suffix such as "+3 +3" or
 * "of Lightning Resistance of Lightning Resistance". */
function deduplicateRepeatedSuffix(value) {
  let tokens = cleanSpacing(value).split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    const maximum = Math.floor(tokens.length / 2);
    for (let width = 1; width <= maximum; width += 1) {
      const left = tokens.slice(tokens.length - (width * 2), tokens.length - width).map(tokenKey);
      const right = tokens.slice(tokens.length - width).map(tokenKey);
      if (left.length === width && left.every((token, index) => token && token === right[index])) {
        tokens = tokens.slice(0, tokens.length - width);
        changed = true;
        break;
      }
    }
  }
  return tokens.join(" ");
}

function removeDuplicateBonusSuffix(value) {
  return String(value ?? "").replace(/(?:\s*\+\s*([123]))(?:\s*\+\s*\1)+\s*$/i, " +$1");
}

function resolvePlaceholderTemplate(template, baseName) {
  let output = String(template ?? "");
  const placeholder = /\{(?:item|base)?\}/gi;
  const base = cleanSpacing(baseName);
  if (!placeholder.test(output)) return output;
  placeholder.lastIndex = 0;

  // Some source enchantments already include the literal base name followed
  // by an additional {} marker. Replacing that marker with the base again
  // creates names such as "Plate Armor Plate Armor of Vulnerability".
  const beforePlaceholder = output.slice(0, output.search(placeholder));
  const literalBaseAlreadyPresent = base && normalizedToken(beforePlaceholder).includes(normalizedToken(base));
  let insertedBase = literalBaseAlreadyPresent;
  output = output.replace(placeholder, () => {
    if (insertedBase) return "";
    insertedBase = true;
    return base;
  });
  return output;
}

export function hasUnresolvedNameMarker(value) {
  const text = String(value ?? "");
  return /\{[^}]*\}|\[object Object\]|\bundefined\b|\bnull\b/i.test(text);
}

export function canonicalizeItemName(value, {
  baseName = "",
  fallbackName = "",
  selectionLabel = ""
} = {}) {
  let output = resolvePlaceholderTemplate(value || fallbackName || baseName, baseName || fallbackName);
  if (selectionLabel) {
    output = output
      .replace(/\{(?:label|type|damageType)\}/gi, selectionLabel)
      .replace(/\{\{(?:label|type|damageType)\}\}/gi, selectionLabel);
  }
  // Empty braces are a common legacy marker. At this stage a base name was
  // already resolved, so any remaining marker must be removed rather than
  // copied into the final Item.
  output = output.replace(/\{\}/g, "");
  output = cleanSpacing(output);
  output = removeDuplicateBonusSuffix(output);
  output = deduplicateRepeatedSuffix(output);
  output = cleanSpacing(output);
  return {
    ok: Boolean(output) && !hasUnresolvedNameMarker(output),
    name: output,
    reason: !output ? "emptyName" : hasUnresolvedNameMarker(output) ? "unresolvedNameMarker" : ""
  };
}

function effectChanges(effect) {
  if (Array.isArray(effect?.changes)) return effect.changes;
  if (Array.isArray(effect?.system?.changes)) return effect.system.changes;
  return [];
}

function setEffectChanges(effect, changes) {
  if (Array.isArray(effect?.changes) || !effect?.system || !Object.hasOwn(effect.system, "changes")) effect.changes = changes;
  else effect.system.changes = changes;
}

function applyIdentityProperty(itemData, key, value) {
  if (key === "img") itemData.img = value;
  else foundry.utils.setProperty(itemData, key, value);
}

/**
 * Resolve identity-only enchantment changes into the concrete Item data.
 * Removing these changes from the Active Effect prevents the prepared Item
 * name/rarity/price from being applied a second time after creation.
 */
export function materializeIdentityChanges(itemData, effect, {
  selectionLabel = ""
} = {}) {
  const output = foundry.utils.deepClone(effect);
  const retained = [];
  let resolvedName = String(itemData?.name ?? "");

  for (const sourceChange of effectChanges(output)) {
    const change = foundry.utils.deepClone(sourceChange);
    const key = String(change?.key ?? "");
    if (key === "name") {
      const resolved = canonicalizeItemName(change.value, {
        baseName: resolvedName,
        fallbackName: resolvedName,
        selectionLabel
      });
      if (!resolved.ok) return { ok: false, reason: resolved.reason, effect: output };
      resolvedName = resolved.name;
      itemData.name = resolved.name;
      continue;
    }
    if ([
      "img",
      "system.rarity",
      "system.magicalBonus",
      "system.armor.magicalBonus",
      "system.price.value",
      "system.price.denomination",
      "system.type.value"
    ].includes(key)) {
      applyIdentityProperty(itemData, key, change.value);
      continue;
    }
    retained.push(change);
  }

  const finalName = canonicalizeItemName(itemData.name, {
    baseName: resolvedName,
    fallbackName: resolvedName,
    selectionLabel
  });
  if (!finalName.ok) return { ok: false, reason: finalName.reason, effect: output };
  itemData.name = finalName.name;
  setEffectChanges(output, retained);
  return { ok: true, effect: output, name: finalName.name };
}

export function cleanResolvedBlueprintDescription(html, { resolved = false } = {}) {
  if (!resolved || typeof html !== "string" || !html.trim()) return html;
  let output = html;
  output = output.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, "");
  output = output.replace(/<p\b[^>]*>[\s\S]*?(?:roll\s+(?:on|the)|randomly\s+determine)[\s\S]*?<\/p>/gi, "");
  output = output.replace(/@UUID\[[^\]]*RollTable[^\]]*\](?:\{[^}]*\})?/gi, "");
  return output.replace(/(?:<p>\s*<\/p>\s*)+/gi, "").trim();
}
