import type Stripe from 'stripe'
import { extractUserId } from '@stravigor/database'
import StripeManager from './stripe_manager.ts'
import Customer from './customer.ts'

interface CheckoutLineItem {
  price: string
  quantity?: number
}

/**
 * Fluent builder for creating Stripe Checkout sessions.
 *
 * @example
 * const session = await new CheckoutBuilder()
 *   .item('price_xxx', 2)
 *   .mode('subscription')
 *   .subscriptionName('pro')
 *   .create(user)
 */
export default class CheckoutBuilder {
  private _items: CheckoutLineItem[] = []
  private _mode: Stripe.Checkout.SessionCreateParams.Mode = 'payment'
  private _successUrl?: string
  private _cancelUrl?: string
  private _allowPromotionCodes = false
  private _metadata: Record<string, string> = {}
  private _subscriptionName?: string
  private _trialDays?: number
  private _customerEmail?: string

  constructor(items?: CheckoutLineItem[]) {
    if (items) this._items = items
  }

  /** Add a line item. */
  item(price: string, quantity?: number): this {
    this._items.push({ price, quantity: quantity ?? 1 })
    return this
  }

  /** Set checkout mode: 'payment' | 'subscription' | 'setup'. */
  mode(mode: Stripe.Checkout.SessionCreateParams.Mode): this {
    this._mode = mode
    return this
  }

  /** Set success URL. Overrides config default. */
  successUrl(url: string): this {
    this._successUrl = url
    return this
  }

  /** Set cancel URL. Overrides config default. */
  cancelUrl(url: string): this {
    this._cancelUrl = url
    return this
  }

  /** Allow promotion codes in the checkout page. */
  allowPromotionCodes(allow = true): this {
    this._allowPromotionCodes = allow
    return this
  }

  /** Set custom metadata. */
  metadata(data: Record<string, string>): this {
    this._metadata = { ...this._metadata, ...data }
    return this
  }

  /** Name the subscription (stored in metadata, used by webhook handler). */
  subscriptionName(name: string): this {
    this._subscriptionName = name
    this._mode = 'subscription'
    return this
  }

  /** Add trial days (subscription mode only). */
  trialDays(days: number): this {
    this._trialDays = days
    return this
  }

  /** Pre-fill customer email (for guest users without a Stripe customer). */
  email(email: string): this {
    this._customerEmail = email
    return this
  }

  /**
   * Create the Stripe Checkout Session.
   * If user is provided, attaches to their Stripe customer.
   */
  async create(user?: unknown): Promise<Stripe.Checkout.Session> {
    const config = StripeManager.config

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: this._mode,
      line_items: this._items.map(i => ({
        price: i.price,
        quantity: i.quantity,
      })),
      success_url: this._successUrl ?? config.urls.success,
      cancel_url: this._cancelUrl ?? config.urls.cancel,
      allow_promotion_codes: this._allowPromotionCodes || undefined,
      metadata: {
        ...(this._subscriptionName ? { strav_name: this._subscriptionName } : {}),
        ...this._metadata,
      },
    }

    if (user) {
      const customer = await Customer.createOrGet(user)
      params.customer = customer.stripeId
      params.metadata!.strav_user_id = String(extractUserId(user))
    } else if (this._customerEmail) {
      params.customer_email = this._customerEmail
    }

    if (this._trialDays && this._mode === 'subscription') {
      params.subscription_data = {
        trial_period_days: this._trialDays,
        metadata: params.metadata,
      }
    }

    return StripeManager.stripe.checkout.sessions.create(params)
  }
}
