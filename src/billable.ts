import type Stripe from 'stripe'
import type { BaseModel } from '@stravigor/database'
import type { NormalizeConstructor } from '@stravigor/kernel'
import { extractUserId } from '@stravigor/database'
import Customer from './customer.ts'
import Subscription from './subscription.ts'
import SubscriptionBuilder from './subscription_builder.ts'
import CheckoutBuilder from './checkout_builder.ts'
import Invoice from './invoice.ts'
import PaymentMethod from './payment_method.ts'
import StripeManager from './stripe_manager.ts'
import type { CustomerData, SubscriptionData } from './types.ts'

// ---------------------------------------------------------------------------
// Bound builders (auto-pass user to .create())
// ---------------------------------------------------------------------------

class BoundSubscriptionBuilder extends SubscriptionBuilder {
  private _user: unknown

  constructor(user: unknown, name: string, ...prices: string[]) {
    super(name, ...prices)
    this._user = user
  }

  override async create(user?: unknown): Promise<SubscriptionData> {
    return super.create(user ?? this._user)
  }
}

class BoundCheckoutBuilder extends CheckoutBuilder {
  private _user: unknown

  constructor(user: unknown) {
    super()
    this._user = user
  }

  override async create(user?: unknown): Promise<Stripe.Checkout.Session> {
    return super.create(user ?? this._user)
  }
}

// ---------------------------------------------------------------------------
// Mixin
// ---------------------------------------------------------------------------

/**
 * Mixin that adds billing methods to a BaseModel subclass.
 *
 * @example
 * import { BaseModel } from '@stravigor/database'
 * import { billable } from '@stravigor/stripe'
 *
 * class User extends billable(BaseModel) {
 *   declare id: number
 *   declare email: string
 * }
 *
 * // Composable with other mixins:
 * import { compose } from '@stravigor/kernel'
 * class User extends compose(BaseModel, softDeletes, billable) { }
 *
 * const user = await User.find(1)
 * await user.subscribe('pro', 'price_xxx')
 * await user.subscribed('pro') // true
 */
export function billable<T extends NormalizeConstructor<typeof BaseModel>>(Base: T) {
  return class Billable extends Base {
    // ----- Customer -----

    /** Get or create the Stripe customer record for this user. */
    async createOrGetStripeCustomer(params?: Stripe.CustomerCreateParams): Promise<CustomerData> {
      return Customer.createOrGet(this, params)
    }

    /** Get the local customer record. */
    async customer(): Promise<CustomerData | null> {
      return Customer.findByUser(this)
    }

    /** Get the Stripe customer ID. */
    async stripeId(): Promise<string | null> {
      const customer = await Customer.findByUser(this)
      return customer?.stripeId ?? null
    }

    /** Check if the user has a Stripe customer record. */
    async hasStripeId(): Promise<boolean> {
      return (await Customer.findByUser(this)) !== null
    }

    // ----- Subscriptions -----

    /**
     * Start building a new subscription.
     *
     * @example
     * await user.newSubscription('pro', 'price_xxx').trialDays(14).create()
     * await user.newSubscription('enterprise', 'price_a', 'price_b').create()
     */
    newSubscription(name: string, ...prices: string[]): BoundSubscriptionBuilder {
      return new BoundSubscriptionBuilder(this, name, ...prices)
    }

    /**
     * Create a subscription immediately (shorthand).
     *
     * @example
     * await user.subscribe('pro', 'price_xxx')
     */
    async subscribe(name: string, priceId: string): Promise<SubscriptionData> {
      return new BoundSubscriptionBuilder(this, name, priceId).create()
    }

    /** Get a specific subscription by name. */
    async subscription(name: string = 'default'): Promise<SubscriptionData | null> {
      return Subscription.findByName(this, name)
    }

    /** Get all subscriptions. */
    async subscriptions(): Promise<SubscriptionData[]> {
      return Subscription.findByUser(this)
    }

    /** Check if the user has a valid subscription with the given name. */
    async subscribed(name: string = 'default'): Promise<boolean> {
      const sub = await Subscription.findByName(this, name)
      return sub !== null && Subscription.valid(sub)
    }

    /** Check if the user is on a trial for the given subscription. */
    async onTrial(name: string = 'default'): Promise<boolean> {
      const sub = await Subscription.findByName(this, name)
      if (sub) return Subscription.onTrial(sub)

      // Also check customer-level trial (generic trial)
      const customer = await Customer.findByUser(this)
      return (
        customer?.trialEndsAt !== null &&
        customer?.trialEndsAt !== undefined &&
        customer.trialEndsAt.getTime() > Date.now()
      )
    }

    /** Check if the user has an active subscription to a specific price ID. */
    async subscribedToPrice(priceId: string): Promise<boolean> {
      const subs = await Subscription.findByUser(this)
      return subs.some(sub => Subscription.valid(sub) && sub.stripePriceId === priceId)
    }

    /** Check if the subscription is on a grace period. */
    async onGracePeriod(name: string = 'default'): Promise<boolean> {
      const sub = await Subscription.findByName(this, name)
      return sub !== null && Subscription.onGracePeriod(sub)
    }

    // ----- One-time Charges -----

    /**
     * Create a one-time charge.
     *
     * @example
     * await user.charge(2500, 'pm_xxx', { description: 'Pro-rated upgrade' })
     */
    async charge(
      amount: number,
      paymentMethodId: string,
      options?: {
        currency?: string
        description?: string
        metadata?: Record<string, string>
      }
    ): Promise<Stripe.PaymentIntent> {
      const customer = await Customer.createOrGet(this)
      return StripeManager.stripe.paymentIntents.create({
        amount,
        currency: options?.currency ?? StripeManager.config.currency,
        customer: customer.stripeId,
        payment_method: paymentMethodId,
        confirm: true,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
        description: options?.description,
        metadata: {
          strav_user_id: String(extractUserId(this)),
          ...options?.metadata,
        },
      })
    }

    /** Refund a payment intent (fully or partially). */
    async refund(paymentIntentId: string, amount?: number): Promise<Stripe.Refund> {
      return StripeManager.stripe.refunds.create({
        payment_intent: paymentIntentId,
        ...(amount ? { amount } : {}),
      })
    }

    // ----- Payment Methods -----

    /** List all payment methods for this user. */
    async paymentMethods(
      type?: Stripe.PaymentMethodListParams.Type
    ): Promise<Stripe.PaymentMethod[]> {
      return PaymentMethod.list(this, type)
    }

    /** Get the default payment method. */
    async defaultPaymentMethod(): Promise<Stripe.PaymentMethod | null> {
      const customer = await Customer.findByUser(this)
      if (!customer) return null
      const methods = await PaymentMethod.list(this)
      return methods[0] ?? null
    }

    /** Set a payment method as default. */
    async setDefaultPaymentMethod(paymentMethodId: string): Promise<void> {
      return PaymentMethod.setDefault(this, paymentMethodId)
    }

    /** Create a Stripe SetupIntent for collecting payment info without charging. */
    async createSetupIntent(params?: Stripe.SetupIntentCreateParams): Promise<Stripe.SetupIntent> {
      return Customer.createSetupIntent(this, params)
    }

    // ----- Checkout -----

    /**
     * Create a Stripe Checkout session.
     *
     * @example
     * const session = await user.checkout([{ price: 'price_xxx', quantity: 1 }])
     */
    async checkout(
      items: Array<{ price: string; quantity?: number }>
    ): Promise<Stripe.Checkout.Session> {
      const builder = new CheckoutBuilder(items)
      return builder.create(this)
    }

    /**
     * Start building a checkout session fluently.
     *
     * @example
     * const session = await user.newCheckout()
     *   .item('price_xxx', 2)
     *   .mode('subscription')
     *   .subscriptionName('pro')
     *   .create()
     */
    newCheckout(): BoundCheckoutBuilder {
      return new BoundCheckoutBuilder(this)
    }

    // ----- Invoices -----

    /** List Stripe invoices for this user. */
    async invoices(params?: Stripe.InvoiceListParams): Promise<Stripe.Invoice[]> {
      return Invoice.list(this, params)
    }

    /** Preview the upcoming invoice. */
    async upcomingInvoice(
      params?: Stripe.InvoiceRetrieveUpcomingParams
    ): Promise<Stripe.UpcomingInvoice | null> {
      return Invoice.upcoming(this, params)
    }

    // ----- Billing Portal -----

    /** Create a Stripe Customer Portal session URL. */
    async billingPortalUrl(returnUrl?: string): Promise<string> {
      const customer = await Customer.createOrGet(this)
      const session = await StripeManager.stripe.billingPortal.sessions.create({
        customer: customer.stripeId,
        return_url: returnUrl ?? StripeManager.config.urls.success,
      })
      return session.url
    }
  }
}

/** The instance type of any billable model. */
export type BillableInstance = InstanceType<ReturnType<typeof billable>>
