import { describe, test, expect, beforeEach } from 'bun:test'
import CheckoutBuilder from '../src/checkout_builder.ts'
import { bootStripe, stripeCheckoutSession, customerRow } from './helpers.ts'

let sql: ReturnType<typeof bootStripe>

describe('CheckoutBuilder', () => {
  beforeEach(() => {
    sql = bootStripe()
  })

  test('creates a payment checkout session', async () => {
    sql.stripe.onCall('checkout.sessions.create', stripeCheckoutSession())

    const session = await new CheckoutBuilder().item('price_xxx', 2).create()

    expect(session.id).toBe('cs_test123')
    expect(session.url).toContain('checkout.stripe.com')
  })

  test('attaches customer when user is provided', async () => {
    sql.setResult([customerRow()])
    sql.stripe.onCall('checkout.sessions.create', stripeCheckoutSession())

    await new CheckoutBuilder().item('price_xxx').create(1)

    const calls = sql.stripe.callsFor('checkout.sessions.create')
    const params = calls[0].args[0] as any
    expect(params.customer).toBe('cus_test123')
  })

  test('uses customer_email for guest checkout', async () => {
    sql.stripe.onCall('checkout.sessions.create', stripeCheckoutSession())

    await new CheckoutBuilder().item('price_xxx').email('guest@example.com').create()

    const calls = sql.stripe.callsFor('checkout.sessions.create')
    const params = calls[0].args[0] as any
    expect(params.customer_email).toBe('guest@example.com')
  })

  test('sets subscription mode with subscriptionName', async () => {
    sql.stripe.onCall('checkout.sessions.create', stripeCheckoutSession({ mode: 'subscription' }))

    const session = await new CheckoutBuilder().item('price_xxx').subscriptionName('pro').create()

    const calls = sql.stripe.callsFor('checkout.sessions.create')
    const params = calls[0].args[0] as any
    expect(params.mode).toBe('subscription')
    expect(params.metadata.strav_name).toBe('pro')
  })

  test('adds trial days for subscription mode', async () => {
    sql.stripe.onCall('checkout.sessions.create', stripeCheckoutSession({ mode: 'subscription' }))

    await new CheckoutBuilder().item('price_xxx').subscriptionName('pro').trialDays(14).create()

    const calls = sql.stripe.callsFor('checkout.sessions.create')
    const params = calls[0].args[0] as any
    expect(params.subscription_data.trial_period_days).toBe(14)
  })

  test('fluent chaining works', () => {
    const builder = new CheckoutBuilder()
      .item('price_a', 1)
      .item('price_b', 2)
      .mode('subscription')
      .successUrl('/ok')
      .cancelUrl('/cancel')
      .allowPromotionCodes()
      .metadata({ foo: 'bar' })

    expect(builder).toBeInstanceOf(CheckoutBuilder)
  })

  test('uses config URLs as defaults', async () => {
    sql.stripe.onCall('checkout.sessions.create', stripeCheckoutSession())

    await new CheckoutBuilder().item('price_xxx').create()

    const calls = sql.stripe.callsFor('checkout.sessions.create')
    const params = calls[0].args[0] as any
    expect(params.success_url).toContain('billing/success')
    expect(params.cancel_url).toContain('billing/cancel')
  })

  test('custom URLs override config defaults', async () => {
    sql.stripe.onCall('checkout.sessions.create', stripeCheckoutSession())

    await new CheckoutBuilder()
      .item('price_xxx')
      .successUrl('/my-success')
      .cancelUrl('/my-cancel')
      .create()

    const calls = sql.stripe.callsFor('checkout.sessions.create')
    const params = calls[0].args[0] as any
    expect(params.success_url).toBe('/my-success')
    expect(params.cancel_url).toBe('/my-cancel')
  })
})
