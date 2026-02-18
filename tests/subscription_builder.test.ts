import { describe, test, expect, beforeEach } from 'bun:test'
import SubscriptionBuilder from '../src/subscription_builder.ts'
import {
  bootStripe,
  stripeSubscription,
  customerRow,
  subscriptionRow,
  subscriptionItemRow,
} from './helpers.ts'

let sql: ReturnType<typeof bootStripe>

describe('SubscriptionBuilder', () => {
  beforeEach(() => {
    sql = bootStripe()
  })

  test('creates subscription on Stripe and locally', async () => {
    // findByUser → existing customer
    let callIndex = 0
    sql.db.sql.unsafe = (sqlStr: string, params: unknown[]) => {
      sql.calls.push({ type: 'unsafe', sql: sqlStr, params })
      callIndex++
      if (callIndex === 1) return Promise.resolve([customerRow()]) // findByUser
      return Promise.resolve([subscriptionRow()]) // INSERT subscription
    }

    // Stripe: subscriptions.create
    sql.stripe.onCall('subscriptions.create', stripeSubscription())

    // INSERT subscription_item (tagged template)
    sql.setResult([subscriptionItemRow()])

    const sub = await new SubscriptionBuilder('default', 'price_test123').create(1)

    expect(sub.name).toBe('default')
    expect(sub.stripeId).toBe('sub_test123')
  })

  test('fluent chaining works', () => {
    const builder = new SubscriptionBuilder('pro', 'price_xxx')
      .quantity(5)
      .trialDays(14)
      .coupon('LAUNCH')
      .promotionCode('promo_abc')
      .metadata({ team: 'alpha' })
      .paymentBehavior('allow_incomplete')

    // Just verify it returns `this` for chaining (no throw)
    expect(builder).toBeInstanceOf(SubscriptionBuilder)
  })

  test('plan() adds additional price items', async () => {
    let callIndex = 0
    sql.db.sql.unsafe = (sqlStr: string, params: unknown[]) => {
      sql.calls.push({ type: 'unsafe', sql: sqlStr, params })
      callIndex++
      if (callIndex === 1) return Promise.resolve([customerRow()])
      return Promise.resolve([subscriptionRow()])
    }

    sql.stripe.onCall(
      'subscriptions.create',
      stripeSubscription({
        items: {
          data: [
            { id: 'si_1', price: { id: 'price_base', product: 'prod_base' }, quantity: 1 },
            { id: 'si_2', price: { id: 'price_addon', product: 'prod_addon' }, quantity: 3 },
          ],
        },
      })
    )
    sql.setResult([subscriptionItemRow()])

    const sub = await new SubscriptionBuilder('pro', 'price_base').plan('price_addon', 3).create(1)

    expect(sub).toBeDefined()

    // Verify Stripe was called with 2 items
    const calls = sql.stripe.callsFor('subscriptions.create')
    expect(calls).toHaveLength(1)
    const params = calls[0].args[0] as any
    expect(params.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ price: 'price_base' }),
        expect.objectContaining({ price: 'price_addon', quantity: 3 }),
      ])
    )
  })

  test('trialDays sets trial_end on Stripe params', async () => {
    let callIndex = 0
    sql.db.sql.unsafe = (sqlStr: string, params: unknown[]) => {
      sql.calls.push({ type: 'unsafe', sql: sqlStr, params })
      callIndex++
      if (callIndex === 1) return Promise.resolve([customerRow()])
      return Promise.resolve([
        subscriptionRow({ trial_ends_at: new Date(Date.now() + 14 * 86400000) }),
      ])
    }

    const trialEnd = Math.floor(Date.now() / 1000) + 14 * 86400
    sql.stripe.onCall(
      'subscriptions.create',
      stripeSubscription({ trial_end: trialEnd, status: 'trialing' })
    )
    sql.setResult([subscriptionItemRow()])

    const sub = await new SubscriptionBuilder('pro', 'price_xxx').trialDays(14).create(1)

    expect(sub).toBeDefined()

    // Verify trial_end was sent to Stripe
    const calls = sql.stripe.callsFor('subscriptions.create')
    const params = calls[0].args[0] as any
    expect(params.trial_end).toBeDefined()
  })

  test('skipTrial prevents trial_end from being set', async () => {
    let callIndex = 0
    sql.db.sql.unsafe = (sqlStr: string, params: unknown[]) => {
      sql.calls.push({ type: 'unsafe', sql: sqlStr, params })
      callIndex++
      if (callIndex === 1) return Promise.resolve([customerRow()])
      return Promise.resolve([subscriptionRow()])
    }

    sql.stripe.onCall('subscriptions.create', stripeSubscription())
    sql.setResult([subscriptionItemRow()])

    await new SubscriptionBuilder('pro', 'price_xxx').trialDays(14).skipTrial().create(1)

    const calls = sql.stripe.callsFor('subscriptions.create')
    const params = calls[0].args[0] as any
    expect(params.trial_end).toBeUndefined()
  })
})
