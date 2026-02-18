import type Stripe from 'stripe'
import { extractUserId } from '@stravigor/database'
import StripeManager from './stripe_manager.ts'
import Customer from './customer.ts'
import Subscription from './subscription.ts'
import SubscriptionItem from './subscription_item.ts'
import { SubscriptionCreationError } from './errors.ts'
import type { SubscriptionData } from './types.ts'

interface PendingItem {
  price: string
  quantity?: number
}

/**
 * Fluent builder for creating Stripe subscriptions.
 *
 * @example
 * const sub = await new SubscriptionBuilder('pro', 'price_xxx')
 *   .trialDays(14)
 *   .coupon('LAUNCH20')
 *   .create(user)
 */
export default class SubscriptionBuilder {
  private _name: string
  private _items: PendingItem[] = []
  private _trialDays?: number
  private _trialUntil?: Date
  private _skipTrial = false
  private _coupon?: string
  private _promotionCode?: string
  private _metadata: Record<string, string> = {}
  private _paymentBehavior: Stripe.SubscriptionCreateParams.PaymentBehavior = 'default_incomplete'
  private _quantity?: number
  private _anchorBillingCycleOn?: number

  constructor(name: string, ...prices: string[]) {
    this._name = name
    for (const price of prices) {
      this._items.push({ price })
    }
  }

  /** Set the default quantity for all items (unless overridden per-item). */
  quantity(qty: number): this {
    this._quantity = qty
    return this
  }

  /** Add a price with an explicit quantity. */
  plan(price: string, quantity?: number): this {
    this._items.push({ price, quantity })
    return this
  }

  /** Set a trial period in days. */
  trialDays(days: number): this {
    this._trialDays = days
    return this
  }

  /** Set a specific trial end date. */
  trialUntil(date: Date): this {
    this._trialUntil = date
    return this
  }

  /** Skip any trial period. */
  skipTrial(): this {
    this._skipTrial = true
    return this
  }

  /** Apply a coupon to the subscription. */
  coupon(couponId: string): this {
    this._coupon = couponId
    return this
  }

  /** Apply a promotion code. */
  promotionCode(code: string): this {
    this._promotionCode = code
    return this
  }

  /** Add custom metadata to the Stripe subscription. */
  metadata(data: Record<string, string>): this {
    this._metadata = { ...this._metadata, ...data }
    return this
  }

  /** Anchor the billing cycle to a specific timestamp. */
  anchorBillingCycleOn(timestamp: number): this {
    this._anchorBillingCycleOn = timestamp
    return this
  }

  /** Set the payment behavior (default: 'default_incomplete'). */
  paymentBehavior(behavior: Stripe.SubscriptionCreateParams.PaymentBehavior): this {
    this._paymentBehavior = behavior
    return this
  }

  /**
   * Create the subscription on Stripe and record it locally.
   * Returns the local SubscriptionData.
   */
  async create(user: unknown): Promise<SubscriptionData> {
    // 1. Ensure Stripe customer exists
    const customer = await Customer.createOrGet(user)

    // 2. Build Stripe params
    const items: Stripe.SubscriptionCreateParams.Item[] = this._items.map(item => ({
      price: item.price,
      quantity: item.quantity ?? this._quantity,
    }))

    const params: Stripe.SubscriptionCreateParams = {
      customer: customer.stripeId,
      items,
      payment_behavior: this._paymentBehavior,
      expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
      metadata: {
        strav_user_id: String(extractUserId(user)),
        strav_name: this._name,
        ...this._metadata,
      },
    }

    // Trial logic
    if (!this._skipTrial) {
      if (this._trialUntil) {
        params.trial_end = Math.floor(this._trialUntil.getTime() / 1000)
      } else if (this._trialDays) {
        params.trial_end = Math.floor(Date.now() / 1000) + this._trialDays * 86400
      }
    }

    if (this._coupon) params.coupon = this._coupon
    if (this._promotionCode) params.promotion_code = this._promotionCode
    if (this._anchorBillingCycleOn) {
      params.billing_cycle_anchor = this._anchorBillingCycleOn
    }

    // 3. Create on Stripe
    let stripeSub: Stripe.Subscription
    try {
      stripeSub = await StripeManager.stripe.subscriptions.create(params)
    } catch (err: any) {
      throw new SubscriptionCreationError(
        `Failed to create Stripe subscription "${this._name}": ${err?.message ?? err}`
      )
    }

    // 4. Record locally
    const trialEndsAt = stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null

    const localSub = await Subscription.create({
      user,
      name: this._name,
      stripeId: stripeSub.id,
      stripeStatus: stripeSub.status,
      stripePriceId: this._items[0]?.price ?? null,
      quantity: this._items[0]?.quantity ?? this._quantity ?? null,
      trialEndsAt,
    })

    // 5. Record subscription items
    for (const item of stripeSub.items.data) {
      await SubscriptionItem.create({
        subscriptionId: localSub.id,
        stripeId: item.id,
        stripeProductId:
          typeof item.price.product === 'string' ? item.price.product : item.price.product.id,
        stripePriceId: item.price.id,
        quantity: item.quantity ?? null,
      })
    }

    return localSub
  }
}
