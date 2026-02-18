import { describe, test, expect, beforeEach } from 'bun:test'
import Subscription from '../src/subscription.ts'
import { SubscriptionStatus } from '../src/types.ts'
import { bootStripe, stripeSubscription, subscriptionRow } from './helpers.ts'

let sql: ReturnType<typeof bootStripe>

describe('Subscription', () => {
  beforeEach(() => {
    sql = bootStripe()
  })

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  describe('findByName', () => {
    test('returns subscription when found', async () => {
      sql.setResult([subscriptionRow()])

      const sub = await Subscription.findByName(1, 'default')

      expect(sub).not.toBeNull()
      expect(sub!.name).toBe('default')
      expect(sub!.stripeId).toBe('sub_test123')
    })

    test('returns null when not found', async () => {
      sql.setResult([])
      expect(await Subscription.findByName(1, 'pro')).toBeNull()
    })
  })

  describe('findByUser', () => {
    test('returns all subscriptions for user', async () => {
      sql.setResult([
        subscriptionRow(),
        subscriptionRow({ id: 2, name: 'pro', stripe_id: 'sub_test456' }),
      ])

      const subs = await Subscription.findByUser(1)

      expect(subs).toHaveLength(2)
    })
  })

  describe('findByStripeId', () => {
    test('returns subscription by Stripe ID', async () => {
      sql.setResult([subscriptionRow()])

      const sub = await Subscription.findByStripeId('sub_test123')

      expect(sub).not.toBeNull()
      expect(sub!.stripeId).toBe('sub_test123')
    })
  })

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  describe('create', () => {
    test('inserts a subscription record', async () => {
      sql.setResult([subscriptionRow()])

      const sub = await Subscription.create({
        user: 1,
        name: 'default',
        stripeId: 'sub_test123',
        stripeStatus: 'active',
        stripePriceId: 'price_test123',
        quantity: 1,
      })

      expect(sub.name).toBe('default')
      expect(sql.calls[0].sql).toContain('INSERT')
    })
  })

  // ---------------------------------------------------------------------------
  // Status Checks (pure functions)
  // ---------------------------------------------------------------------------

  describe('status checks', () => {
    test('active() returns true for active, trialing, past_due', () => {
      expect(Subscription.active(subscriptionData({ stripeStatus: 'active' }))).toBe(true)
      expect(Subscription.active(subscriptionData({ stripeStatus: 'trialing' }))).toBe(true)
      expect(Subscription.active(subscriptionData({ stripeStatus: 'past_due' }))).toBe(true)
      expect(Subscription.active(subscriptionData({ stripeStatus: 'canceled' }))).toBe(false)
      expect(Subscription.active(subscriptionData({ stripeStatus: 'incomplete' }))).toBe(false)
    })

    test('onTrial() checks trialEndsAt is in the future', () => {
      const future = new Date(Date.now() + 86400000)
      const past = new Date(Date.now() - 86400000)

      expect(Subscription.onTrial(subscriptionData({ trialEndsAt: future }))).toBe(true)
      expect(Subscription.onTrial(subscriptionData({ trialEndsAt: past }))).toBe(false)
      expect(Subscription.onTrial(subscriptionData({ trialEndsAt: null }))).toBe(false)
    })

    test('onGracePeriod() checks endsAt is in the future', () => {
      const future = new Date(Date.now() + 86400000)
      const past = new Date(Date.now() - 86400000)

      expect(Subscription.onGracePeriod(subscriptionData({ endsAt: future }))).toBe(true)
      expect(Subscription.onGracePeriod(subscriptionData({ endsAt: past }))).toBe(false)
      expect(Subscription.onGracePeriod(subscriptionData({ endsAt: null }))).toBe(false)
    })

    test('canceled() returns true when endsAt is set', () => {
      expect(Subscription.canceled(subscriptionData({ endsAt: new Date() }))).toBe(true)
      expect(Subscription.canceled(subscriptionData({ endsAt: null }))).toBe(false)
    })

    test('ended() returns true when canceled and past grace period', () => {
      const past = new Date(Date.now() - 86400000)
      const future = new Date(Date.now() + 86400000)

      expect(Subscription.ended(subscriptionData({ endsAt: past }))).toBe(true)
      expect(Subscription.ended(subscriptionData({ endsAt: future }))).toBe(false)
      expect(Subscription.ended(subscriptionData({ endsAt: null }))).toBe(false)
    })

    test('pastDue() checks stripe status', () => {
      expect(Subscription.pastDue(subscriptionData({ stripeStatus: 'past_due' }))).toBe(true)
      expect(Subscription.pastDue(subscriptionData({ stripeStatus: 'active' }))).toBe(false)
    })

    test('recurring() returns true when not on trial and not canceled', () => {
      expect(Subscription.recurring(subscriptionData())).toBe(true)
      expect(
        Subscription.recurring(subscriptionData({ trialEndsAt: new Date(Date.now() + 86400000) }))
      ).toBe(false)
      expect(Subscription.recurring(subscriptionData({ endsAt: new Date() }))).toBe(false)
    })

    test('valid() combines active, onTrial, and onGracePeriod', () => {
      // Active subscription
      expect(Subscription.valid(subscriptionData({ stripeStatus: 'active' }))).toBe(true)

      // On trial
      expect(
        Subscription.valid(
          subscriptionData({
            stripeStatus: 'trialing',
            trialEndsAt: new Date(Date.now() + 86400000),
          })
        )
      ).toBe(true)

      // On grace period
      expect(
        Subscription.valid(
          subscriptionData({
            stripeStatus: 'canceled',
            endsAt: new Date(Date.now() + 86400000),
          })
        )
      ).toBe(true)

      // Expired
      expect(
        Subscription.valid(
          subscriptionData({
            stripeStatus: 'canceled',
            endsAt: new Date(Date.now() - 86400000),
          })
        )
      ).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  describe('cancel', () => {
    test('cancels at period end and sets endsAt', async () => {
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400
      sql.stripe.onCall(
        'subscriptions.update',
        stripeSubscription({ status: 'active', current_period_end: periodEnd })
      )
      sql.setResult([])

      const sub = subscriptionData()
      const result = await Subscription.cancel(sub)

      expect(result.stripeStatus).toBe('active')
      expect(result.endsAt).toBeInstanceOf(Date)
      expect(sql.calls[0].params).toContain('active')
    })
  })

  describe('cancelNow', () => {
    test('cancels immediately and sets status to canceled', async () => {
      sql.stripe.onCall('subscriptions.cancel', stripeSubscription({ status: 'canceled' }))
      sql.setResult([])

      const sub = subscriptionData()
      const result = await Subscription.cancelNow(sub)

      expect(result.stripeStatus).toBe('canceled')
      expect(result.endsAt).toBeInstanceOf(Date)
    })
  })

  describe('resume', () => {
    test('resumes a subscription on grace period', async () => {
      sql.stripe.onCall('subscriptions.update', stripeSubscription({ status: 'active' }))
      sql.setResult([])

      const sub = subscriptionData({ endsAt: new Date(Date.now() + 86400000) })
      const result = await Subscription.resume(sub)

      expect(result.stripeStatus).toBe('active')
      expect(result.endsAt).toBeNull()
    })

    test('throws when not on grace period', async () => {
      const sub = subscriptionData({ endsAt: null })

      expect(Subscription.resume(sub)).rejects.toThrow('grace period')
    })
  })

  describe('swap', () => {
    test('swaps to a new price', async () => {
      sql.stripe.onCall('subscriptions.retrieve', stripeSubscription())
      sql.stripe.onCall('subscriptions.update', stripeSubscription({ status: 'active' }))
      sql.setResult([])

      const sub = subscriptionData()
      const result = await Subscription.swap(sub, 'price_new')

      expect(result.stripePriceId).toBe('price_new')
      expect(result.endsAt).toBeNull()
    })
  })

  describe('syncStripeStatus', () => {
    test('updates status and endsAt', async () => {
      sql.setResult([])

      await Subscription.syncStripeStatus('sub_test123', 'past_due', new Date())

      expect(sql.calls).toHaveLength(1)
      expect(sql.calls[0].params).toContain('past_due')
    })

    test('updates status only when endsAt undefined', async () => {
      sql.setResult([])

      await Subscription.syncStripeStatus('sub_test123', 'active')

      expect(sql.calls).toHaveLength(1)
      expect(sql.calls[0].params).toContain('active')
    })
  })
})

// ---------------------------------------------------------------------------
// Helper to build SubscriptionData in-memory
// ---------------------------------------------------------------------------

function subscriptionData(
  overrides: Partial<{
    stripeStatus: string
    trialEndsAt: Date | null
    endsAt: Date | null
    stripePriceId: string | null
  }> = {}
) {
  return {
    id: 1,
    userId: 1,
    name: 'default',
    stripeId: 'sub_test123',
    stripeStatus: overrides.stripeStatus ?? 'active',
    stripePriceId: overrides.stripePriceId ?? 'price_test123',
    quantity: 1,
    trialEndsAt: overrides.trialEndsAt ?? null,
    endsAt: overrides.endsAt ?? null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  }
}
