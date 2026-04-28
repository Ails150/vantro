// lib/billing.ts
// Vantro tiered billing — shared logic

export const TIERS = {
  starter: {
    name: 'Starter',
    price: 299, // price_polish_v1
    installerLimit: 40,
    priceId: process.env.STRIPE_PRICE_STARTER!,
  },
  growth: {
    name: 'Growth',
    price: 399,
    installerLimit: 70,
    priceId: process.env.STRIPE_PRICE_GROWTH!,
  },
  scale: {
    name: 'Scale',
    price: 499,
    installerLimit: 100,
    priceId: process.env.STRIPE_PRICE_SCALE!,
  },
} as const

export type TierKey = keyof typeof TIERS

/**
 * Given an installer count at signup, auto-select the appropriate tier.
 * Always selects the lowest tier that fits the count.
 */
export function getTierForInstallerCount(count: number): TierKey {
  if (count <= 40) return 'starter'
  if (count <= 70) return 'growth'
  if (count <= 100) return 'scale'
  // Over 100 — default to scale, sales conversation needed
  return 'scale'
}

export function getTierDetails(tier: TierKey) {
  return TIERS[tier]
}

export function getNextTier(currentTier: TierKey): TierKey | null {
  if (currentTier === 'starter') return 'growth'
  if (currentTier === 'growth') return 'scale'
  return null // already at scale
}

/**
 * Check if an installer count would breach the current tier limit.
 * Returns true if blocked (over limit).
 */
export function isInstallerLimitBreached(
  currentCount: number,
  limit: number
): boolean {
  return currentCount >= limit
}

export function formatTrialDaysRemaining(trialEndsAt: string): number {
  const end = new Date(trialEndsAt)
  const now = new Date()
  const diff = end.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}