/** D&D5e Attack Activities may leave the attack mode blank to derive it from
 * the host Weapon. Never treat that native "automatic" state as corruption. */
export function isSupportedAttackMode(value, sourceData = null) {
  const mode = String(value ?? "");
  if (mode === "" || mode === "melee" || mode === "ranged") return true;
  // Unknown/extended native modes may be carried through an import unchanged.
  return Boolean(sourceData && String(sourceData?.attack?.type?.value ?? "") === mode);
}

export function attackActivityValidationError(row, index, parts, validateDamageRow) {
  if (!String(row?.name ?? "").trim()) return "Activity name is required.";
  if ((parts ?? []).some(part => !validateDamageRow(part))) {
    return "A damage part has invalid dice, damage type, or progression settings.";
  }
  if (index > 0 && row?.inheritPrimaryAttack === false) {
    if (!isSupportedAttackMode(row.attackType, row.sourceData)) {
      return "Attack Type must be Automatic, Melee, Ranged, or the unchanged imported native type.";
    }
    const threshold = row.criticalThreshold;
    if (threshold !== "" && threshold !== null && threshold !== undefined) {
      const value = Number(threshold);
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        return "Critical Threshold must be a whole number from 1 to 20, or blank for the native default.";
      }
    }
  }
  return null;
}

/** Preserve native part metadata (custom dice, scaling, modifiers) when the
 * editor has not changed the portion of the part that it exposes. */
export function nativeDamagePartsUnchanged(parts = [], rows = []) {
  if (parts.length !== rows.length) return false;
  return parts.every((part, index) => {
    const row = rows[index];
    return Number(part?.number ?? 0) === Number(row?.number ?? 0)
      && Number(part?.denomination ?? 0) === Number(row?.denomination ?? 0)
      && String(part?.types?.[0] ?? "") === String(row?.damageType ?? "")
      && String(part?.bonus ?? "") === String(row?.bonus ?? "")
      && !row?.useAbilityModifier && !(row?.unlockOnLevel || (row?.tiers?.length ?? 0));
  });
}
