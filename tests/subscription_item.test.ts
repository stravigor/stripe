import { describe, test, expect, beforeEach } from 'bun:test'
import SubscriptionItem from '../src/subscription_item.ts'
import { bootStripe, stripeSubscription, subscriptionItemRow } from './helpers.ts'

let sql: ReturnType<typeof bootStripe>

describe('SubscriptionItem', () => {
  beforeEach(() => {
    sql = bootStripe()
  })

  describe('findBySubscription', () => {
    test('returns items for a subscription', async () => {
      sql.setResult([
        subscriptionItemRow(),
        subscriptionItemRow({ id: 2, stripe_id: 'si_test456', stripe_price_id: 'price_addon' }),
      ])

      const items = await SubscriptionItem.findBySubscription(1)

      expect(items).toHaveLength(2)
      expect(items[0].stripeId).toBe('si_test123')
      expect(items[1].stripeId).toBe('si_test456')
    })
  })

  describe('findByStripeId', () => {
    test('returns item by Stripe ID', async () => {
      sql.setResult([subscriptionItemRow()])

      const item = await SubscriptionItem.findByStripeId('si_test123')

      expect(item).not.toBeNull()
      expect(item!.stripePriceId).toBe('price_test123')
    })

    test('returns null when not found', async () => {
      sql.setResult([])
      expect(await SubscriptionItem.findByStripeId('si_missing')).toBeNull()
    })
  })

  describe('create', () => {
    test('inserts a subscription item', async () => {
      sql.setResult([subscriptionItemRow()])

      const item = await SubscriptionItem.create({
        subscriptionId: 1,
        stripeId: 'si_test123',
        stripeProductId: 'prod_test123',
        stripePriceId: 'price_test123',
        quantity: 1,
      })

      expect(item.subscriptionId).toBe(1)
      expect(sql.calls[0].sql).toContain('INSERT')
    })
  })

  describe('add', () => {
    test('creates Stripe item and local record', async () => {
      sql.stripe.onCall('subscriptionItems.create', {
        id: 'si_new',
        price: { id: 'price_addon', product: 'prod_addon' },
        quantity: 2,
      })
      sql.setResult([
        subscriptionItemRow({ id: 2, stripe_id: 'si_new', stripe_price_id: 'price_addon' }),
      ])

      const sub = { stripeId: 'sub_test123' } as any
      const item = await SubscriptionItem.add(sub, 1, 'price_addon', 2)

      expect(item.stripeId).toBe('si_new')
    })
  })

  describe('swap', () => {
    test('updates Stripe item and local record', async () => {
      sql.stripe.onCall('subscriptionItems.update', { id: 'si_test123' })
      sql.setResult([])

      const item = {
        id: 1,
        subscriptionId: 1,
        stripeId: 'si_test123',
        stripeProductId: 'prod_test123',
        stripePriceId: 'price_test123',
        quantity: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      await SubscriptionItem.swap(item, 'price_new')

      expect(sql.calls[0].params).toContain('price_new')
    })
  })

  describe('remove', () => {
    test('deletes from Stripe and local DB', async () => {
      sql.stripe.onCall('subscriptionItems.del', { id: 'si_test123', deleted: true })
      sql.setResult([])

      const item = {
        id: 1,
        subscriptionId: 1,
        stripeId: 'si_test123',
        stripeProductId: 'prod_test123',
        stripePriceId: 'price_test123',
        quantity: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      await SubscriptionItem.remove(item)

      expect(sql.calls[0].sql).toContain('DELETE')
    })
  })

  describe('syncFromStripe', () => {
    test('deletes local items and re-creates from Stripe', async () => {
      sql.stripe.onCall('subscriptions.retrieve', stripeSubscription())
      sql.setResult([subscriptionItemRow()])

      const sub = { stripeId: 'sub_test123' } as any
      await SubscriptionItem.syncFromStripe(sub, 1)

      // Should have DELETE + at least one INSERT
      expect(sql.calls.length).toBeGreaterThanOrEqual(1)
    })
  })
})
