import type Stripe from 'stripe'
import StripeManager from './stripe_manager.ts'
import Customer from './customer.ts'
import { PaymentMethodError } from './errors.ts'

/**
 * Static helper for managing Stripe payment methods.
 *
 * @example
 * const methods = await PaymentMethod.list(user)
 * await PaymentMethod.setDefault(user, 'pm_xxx')
 */
export default class PaymentMethod {
  /** List all payment methods for a user. */
  static async list(
    user: unknown,
    type: Stripe.PaymentMethodListParams.Type = 'card'
  ): Promise<Stripe.PaymentMethod[]> {
    return Customer.paymentMethods(user, type)
  }

  /** Retrieve a single payment method from Stripe. */
  static async find(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    return StripeManager.stripe.paymentMethods.retrieve(paymentMethodId)
  }

  /** Set a payment method as the customer's default. */
  static async setDefault(user: unknown, paymentMethodId: string): Promise<void> {
    const customer = await Customer.createOrGet(user)

    // Attach if not already attached
    try {
      await StripeManager.stripe.paymentMethods.attach(paymentMethodId, {
        customer: customer.stripeId,
      })
    } catch (err: any) {
      // Only ignore "already attached" errors — rethrow everything else
      if (err?.code !== 'resource_already_exists') {
        throw new PaymentMethodError(
          `Failed to attach payment method "${paymentMethodId}": ${err?.message ?? err}`
        )
      }
    }

    // Set as default on Stripe
    await StripeManager.stripe.customers.update(customer.stripeId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    })

    // Update local record
    const pm = await StripeManager.stripe.paymentMethods.retrieve(paymentMethodId)
    await Customer.updateDefaultPaymentMethod(customer.stripeId, pm)
  }

  /** Detach a payment method from the customer. */
  static async delete(paymentMethodId: string): Promise<void> {
    return Customer.deletePaymentMethod(paymentMethodId)
  }
}
