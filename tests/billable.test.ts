import { describe, test, expect, beforeEach } from 'bun:test'
import { BaseModel } from '@stravigor/database'
import { compose } from '@stravigor/kernel'
import { billable } from '../src/billable.ts'
import {
  bootStripe,
  stripeSubscription,
  stripePaymentIntent,
  stripePaymentMethod,
  stripeCheckoutSession,
  stripeSetupIntent,
  customerRow,
  subscriptionRow,
  subscriptionItemRow,
} from './helpers.ts'

// ---------------------------------------------------------------------------
// Test model
// ---------------------------------------------------------------------------

class User extends billable(BaseModel) {
  declare id: number
  declare email: string
}

let sql: ReturnType<typeof bootStripe>

describe('billable mixin', () => {
  beforeEach(() => {
    sql = bootStripe()
  })

  function makeUser(id = 1): User {
    const u = new User()
    ;(u as any).id = id
    ;(u as any)._exists = true
    return u
  }

  // ---------------------------------------------------------------------------
  // Customer methods
  // ---------------------------------------------------------------------------

  describe('customer methods', () => {
    test('customer() returns local record', async () => {
      sql.setResult([customerRow()])

      const user = makeUser()
      const customer = await user.customer()

      expect(customer).not.toBeNull()
      expect(customer!.stripeId).toBe('cus_test123')
    })

    test('hasStripeId() returns true when customer exists', async () => {
      sql.setResult([customerRow()])
      expect(await makeUser().hasStripeId()).toBe(true)
    })

    test('hasStripeId() returns false when no customer', async () => {
      sql.setResult([])
      expect(await makeUser().hasStripeId()).toBe(false)
    })

    test('stripeId() returns the Stripe customer ID', async () => {
      sql.setResult([customerRow()])
      expect(await makeUser().stripeId()).toBe('cus_test123')
    })

    test('stripeId() returns null when no customer', async () => {
      sql.setResult([])
      expect(await makeUser().stripeId()).toBeNull()
    })

    test('createOrGetStripeCustomer() delegates to Customer.createOrGet', async () => {
      sql.setResult([customerRow()])

      const customer = await makeUser().createOrGetStripeCustomer()
      expect(customer.stripeId).toBe('cus_test123')
    })
  })

  // ---------------------------------------------------------------------------
  // Subscription methods
  // ---------------------------------------------------------------------------

  describe('subscription methods', () => {
    test('subscribed() returns true for active subscription', async () => {
      sql.setResult([subscriptionRow()])
      expect(await makeUser().subscribed('default')).toBe(true)
    })

    test('subscribed() returns false when no subscription', async () => {
      sql.setResult([])
      expect(await makeUser().subscribed('pro')).toBe(false)
    })

    test('subscribed() defaults to "default" name', async () => {
      sql.setResult([subscriptionRow()])

      await makeUser().subscribed()

      expect(sql.calls[0].params).toContain('default')
    })

    test('subscription() returns subscription data', async () => {
      sql.setResult([subscriptionRow({ name: 'pro' })])

      const sub = await makeUser().subscription('pro')

      expect(sub).not.toBeNull()
      expect(sub!.name).toBe('pro')
    })

    test('subscriptions() returns all subscriptions', async () => {
      sql.setResult([subscriptionRow(), subscriptionRow({ id: 2, name: 'pro' })])

      const subs = await makeUser().subscriptions()

      expect(subs).toHaveLength(2)
    })

    test('onTrial() checks subscription trial', async () => {
      sql.setResult([subscriptionRow({ trial_ends_at: new Date(Date.now() + 86400000) })])

      expect(await makeUser().onTrial('default')).toBe(true)
    })

    test('onTrial() falls back to customer-level trial', async () => {
      // No subscription found
      let callIndex = 0
      sql.db.sql.unsafe = (sqlStr: string, params: unknown[]) => {
        sql.calls.push({ type: 'unsafe', sql: sqlStr, params })
        callIndex++
        if (callIndex === 1) return Promise.resolve([]) // findByName → no sub
        return Promise.resolve([customerRow({ trial_ends_at: new Date(Date.now() + 86400000) })])
      }

      expect(await makeUser().onTrial('default')).toBe(true)
    })

    test('onGracePeriod() checks subscription grace period', async () => {
      sql.setResult([subscriptionRow({ ends_at: new Date(Date.now() + 86400000) })])

      expect(await makeUser().onGracePeriod('default')).toBe(true)
    })

    test('subscribedToPrice() checks price ID across subscriptions', async () => {
      sql.setResult([subscriptionRow({ stripe_price_id: 'price_pro' })])

      expect(await makeUser().subscribedToPrice('price_pro')).toBe(true)
      sql.setResult([subscriptionRow({ stripe_price_id: 'price_other' })])
      expect(await makeUser().subscribedToPrice('price_pro')).toBe(false)
    })

    test('newSubscription() returns a builder', () => {
      const builder = makeUser().newSubscription('pro', 'price_xxx')
      expect(builder).toBeDefined()
      expect(typeof builder.create).toBe('function')
      expect(typeof builder.trialDays).toBe('function')
    })

    test('subscribe() is a shorthand for newSubscription().create()', async () => {
      let callIndex = 0
      sql.db.sql.unsafe = (sqlStr: string, params: unknown[]) => {
        sql.calls.push({ type: 'unsafe', sql: sqlStr, params })
        callIndex++
        if (callIndex === 1) return Promise.resolve([customerRow()]) // findByUser
        return Promise.resolve([subscriptionRow()]) // INSERT subscription
      }

      sql.stripe.onCall('subscriptions.create', stripeSubscription())
      sql.setResult([subscriptionItemRow()])

      const sub = await makeUser().subscribe('default', 'price_xxx')
      expect(sub.name).toBe('default')
    })
  })

  // ---------------------------------------------------------------------------
  // Charge methods
  // ---------------------------------------------------------------------------

  describe('charge methods', () => {
    test('charge() creates a PaymentIntent', async () => {
      sql.setResult([customerRow()])
      sql.stripe.onCall('paymentIntents.create', stripePaymentIntent())

      const pi = await makeUser().charge(2500, 'pm_test123')

      expect(pi.id).toBe('pi_test123')
      expect(pi.amount).toBe(2500)
    })

    test('charge() accepts options', async () => {
      sql.setResult([customerRow()])
      sql.stripe.onCall('paymentIntents.create', stripePaymentIntent({ currency: 'eur' }))

      const pi = await makeUser().charge(1000, 'pm_test123', {
        currency: 'eur',
        description: 'Addon purchase',
      })

      expect(pi).toBeDefined()
    })

    test('refund() creates a Refund', async () => {
      sql.stripe.onCall('refunds.create', { id: 're_test', amount: 2500 })

      const refund = await makeUser().refund('pi_test123')

      expect(refund.id).toBe('re_test')
    })
  })

  // ---------------------------------------------------------------------------
  // Payment method methods
  // ---------------------------------------------------------------------------

  describe('payment methods', () => {
    test('paymentMethods() lists methods', async () => {
      sql.setResult([customerRow()])
      sql.stripe.onCall('paymentMethods.list', { data: [stripePaymentMethod()], has_more: false })

      const methods = await makeUser().paymentMethods()

      expect(methods).toHaveLength(1)
    })

    test('createSetupIntent() returns a SetupIntent', async () => {
      sql.setResult([customerRow()])
      sql.stripe.onCall('setupIntents.create', stripeSetupIntent())

      const intent = await makeUser().createSetupIntent()

      expect(intent.id).toBe('seti_test123')
    })
  })

  // ---------------------------------------------------------------------------
  // Checkout
  // ---------------------------------------------------------------------------

  describe('checkout', () => {
    test('checkout() creates a session with items', async () => {
      sql.setResult([customerRow()])
      sql.stripe.onCall('checkout.sessions.create', stripeCheckoutSession())

      const session = await makeUser().checkout([{ price: 'price_xxx', quantity: 1 }])

      expect(session.url).toContain('checkout.stripe.com')
    })

    test('newCheckout() returns a builder', () => {
      const builder = makeUser().newCheckout()
      expect(typeof builder.item).toBe('function')
      expect(typeof builder.mode).toBe('function')
      expect(typeof builder.create).toBe('function')
    })
  })

  // ---------------------------------------------------------------------------
  // Invoices
  // ---------------------------------------------------------------------------

  describe('invoices', () => {
    test('invoices() lists invoices', async () => {
      sql.setResult([customerRow()])
      sql.stripe.onCall('invoices.list', { data: [{ id: 'in_test' }], has_more: false })

      const invoices = await makeUser().invoices()

      expect(invoices).toHaveLength(1)
    })

    test('upcomingInvoice() returns upcoming preview', async () => {
      sql.setResult([customerRow()])
      sql.stripe.onCall('invoices.retrieveUpcoming', { amount_due: 5000, currency: 'usd' })

      const upcoming = await makeUser().upcomingInvoice()

      expect(upcoming).not.toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Billing Portal
  // ---------------------------------------------------------------------------

  describe('billingPortalUrl', () => {
    test('returns portal session URL', async () => {
      sql.setResult([customerRow()])
      sql.stripe.onCall('billingPortal.sessions.create', {
        url: 'https://billing.stripe.com/session/xxx',
      })

      const url = await makeUser().billingPortalUrl()

      expect(url).toContain('billing.stripe.com')
    })
  })

  // ---------------------------------------------------------------------------
  // Compose compatibility
  // ---------------------------------------------------------------------------

  describe('compose', () => {
    test('works with compose() helper', () => {
      function timestamps<T extends new (...args: any[]) => any>(Base: T) {
        return class extends Base {
          touchedAt = new Date()
        }
      }

      class ComposedUser extends compose(BaseModel, timestamps, billable) {
        declare id: number
      }

      const user = new ComposedUser()
      expect(user).toHaveProperty('touchedAt')
      expect(typeof user.subscribed).toBe('function')
      expect(typeof user.charge).toBe('function')
    })
  })
})
