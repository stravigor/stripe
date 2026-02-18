import type Stripe from 'stripe'
import StripeManager from './stripe_manager.ts'
import Customer from './customer.ts'
import Subscription from './subscription.ts'
import SubscriptionBuilder from './subscription_builder.ts'
import CheckoutBuilder from './checkout_builder.ts'
import Invoice from './invoice.ts'
import PaymentMethod from './payment_method.ts'
import Receipt from './receipt.ts'
import type { CustomerData, SubscriptionData, ReceiptData } from './types.ts'

/**
 * Stripe helper object — the primary convenience API.
 *
 * @example
 * import { stripe } from '@stravigor/stripe'
 *
 * // Direct Stripe instance access
 * stripe.stripe.customers.list()
 *
 * // Subscription builder
 * await stripe.newSubscription('pro', 'price_xxx').trialDays(14).create(user)
 *
 * // Checkout builder
 * const session = await stripe.newCheckout().item('price_xxx').mode('payment').create(user)
 */
export const stripe = {
  /** Direct access to the configured Stripe SDK instance. */
  get stripe(): Stripe {
    return StripeManager.stripe
  },

  /** The Stripe publishable key (for frontend use). */
  get key(): string {
    return StripeManager.config.key
  },

  /** The configured default currency. */
  get currency(): string {
    return StripeManager.config.currency
  },

  // ----- Customer -----

  /** Get or create a Stripe customer for a user. */
  createOrGetCustomer(user: unknown, params?: Stripe.CustomerCreateParams): Promise<CustomerData> {
    return Customer.createOrGet(user, params)
  },

  /** Find the local customer record for a user. */
  findCustomer(user: unknown): Promise<CustomerData | null> {
    return Customer.findByUser(user)
  },

  // ----- Subscriptions -----

  /** Start building a new subscription. */
  newSubscription(name: string, ...prices: string[]): SubscriptionBuilder {
    return new SubscriptionBuilder(name, ...prices)
  },

  /** Find a user's subscription by name. */
  subscription(user: unknown, name: string = 'default'): Promise<SubscriptionData | null> {
    return Subscription.findByName(user, name)
  },

  /** Check if a user has a valid subscription. */
  async subscribed(user: unknown, name: string = 'default'): Promise<boolean> {
    const sub = await Subscription.findByName(user, name)
    return sub !== null && Subscription.valid(sub)
  },

  // ----- Checkout -----

  /** Start building a Stripe Checkout session. */
  newCheckout(): CheckoutBuilder {
    return new CheckoutBuilder()
  },

  // ----- Invoices -----

  /** List invoices for a user. */
  invoices(user: unknown, params?: Stripe.InvoiceListParams): Promise<Stripe.Invoice[]> {
    return Invoice.list(user, params)
  },

  /** Preview the upcoming invoice. */
  upcomingInvoice(user: unknown): Promise<Stripe.UpcomingInvoice | null> {
    return Invoice.upcoming(user)
  },

  // ----- Payment Methods -----

  /** List payment methods for a user. */
  paymentMethods(user: unknown): Promise<Stripe.PaymentMethod[]> {
    return PaymentMethod.list(user)
  },

  /** Set a payment method as default. */
  setDefaultPaymentMethod(user: unknown, paymentMethodId: string): Promise<void> {
    return PaymentMethod.setDefault(user, paymentMethodId)
  },

  // ----- Receipts -----

  /** List receipts for a user. */
  receipts(user: unknown): Promise<ReceiptData[]> {
    return Receipt.findByUser(user)
  },
}
