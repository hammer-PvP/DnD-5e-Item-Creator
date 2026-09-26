export const MIN_CHARACTER_LEVEL = 1;
export const MAX_CHARACTER_LEVEL = 20;

export function clampCharacterLevel(value, fallback = MIN_CHARACTER_LEVEL) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(MAX_CHARACTER_LEVEL, Math.max(MIN_CHARACTER_LEVEL, Math.trunc(numeric)));
}

export function actorTotalLevel(actor) {
  const rawDirect = actor?.system?.details?.level;
  const direct = rawDirect === null || rawDirect === undefined || rawDirect === "" ? Number.NaN : Number(rawDirect);
  if (Number.isFinite(direct) && direct >= 0) return Math.trunc(direct);

  let total = 0;
  for (const item of actor?.items ?? []) {
    if (item?.type !== "class") continue;
    const levels = Number(item.system?.levels ?? item.system?.level ?? 0);
    if (Number.isFinite(levels) && levels > 0) total += Math.trunc(levels);
  }
  return total;
}

export function settingHasProgression(setting) {
  if (!setting || typeof setting !== "object") return false;
  return Boolean(setting.unlockOnLevel) || (Array.isArray(setting.tiers) && setting.tiers.length > 0);
}

export function progressionVariants(setting) {
  if (!setting || typeof setting !== "object") return [];
  const base = { ...setting, tierId: "base", tierOrder: 0 };
  delete base.tiers;
  const tiers = (setting.tiers ?? []).map((tier, index) => ({
    ...tier,
    tierId: tier.id ?? `tier-${index + 1}`,
    tierOrder: index + 1,
    unlockOnLevel: tier.unlockOnLevel !== false
  }));
  return [base, ...tiers];
}

export function variantLevel(variant) {
  return variant?.unlockOnLevel ? clampCharacterLevel(variant.unlockLevel) : 0;
}

export function variantEligible(variant, actorLevel = null) {
  if (!variant?.unlockOnLevel) return true;
  if (actorLevel === null || actorLevel === undefined) return false;
  return Number(actorLevel) >= clampCharacterLevel(variant.unlockLevel);
}

export function selectProgressionTier(setting, actorLevel = null) {
  const eligible = progressionVariants(setting).filter(variant => variantEligible(variant, actorLevel));
  eligible.sort((left, right) => {
    const levelDifference = variantLevel(left) - variantLevel(right);
    if (levelDifference) return levelDifference;
    return Number(left.tierOrder ?? 0) - Number(right.tierOrder ?? 0);
  });
  return eligible.at(-1) ?? null;
}

export function validUnlockSetting(setting, { allowTiers = true } = {}) {
  if (!setting || typeof setting !== "object") return false;
  const variants = progressionVariants(setting);
  const gatedLevels = [];
  for (const variant of variants) {
    if (!variant.unlockOnLevel) continue;
    const raw = Number(variant.unlockLevel);
    if (!Number.isInteger(raw) || raw < MIN_CHARACTER_LEVEL || raw > MAX_CHARACTER_LEVEL) return false;
    gatedLevels.push(raw);
  }
  if (!allowTiers && variants.length > 1) return false;
  return new Set(gatedLevels).size === gatedLevels.length;
}

export function stripProgressionMetadata(value) {
  if (!value || typeof value !== "object") return value;
  const clean = { ...value };
  for (const key of ["unlockOnLevel", "unlockLevel", "progressionGroupId", "tiers", "tierId", "tierOrder", "id"]) {
    delete clean[key];
  }
  return clean;
}
