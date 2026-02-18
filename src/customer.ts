import type Stripe from 'stripe'
import { extractUserId } from '@stravigor/database'
import StripeManager from './stripe_manager.ts'
import type { CustomerData } from './types.ts'

/**
 * Static helper for managing Stripe customer records.
 *
 * All methods are static. Database access goes through StripeManager.db.
 *
 * @example
 * const customer = await Customer.createOrGet(user)
 * const methods = await Customer.paymentMethods(user)
 */
export default class Customer {
  private static get sql() {
    return StripeManager.db.sql
  }

  private static get fk() {
    return StripeManager.userFkColumn
  }

  /** Find a customer record by user (model instance or ID). */
  static async findByUser(user: unknown): Promise<CustomerData | null> {
    const userId = extractUserId(user)
    const fk = Customer.fk
    const rows = await Customer.sql.unsafe(`SELECT * FROM "customer" WHERE "${fk}" = $1 LIMIT 1`, [
      userId,
    ])
    return rows.length > 0 ? Customer.hydrate(rows[0] as Record<string, unknown>) : null
  }

  /** Find a customer record by Stripe customer ID. */
  static async findByStripeId(stripeId: string): Promise<CustomerData | null> {
    const rows = await Customer.sql`
      SELECT * FROM "customer" WHERE "stripe_id" = ${stripeId} LIMIT 1
    `
    return rows.length > 0 ? Customer.hydrate(rows[0] as Record<string, unknown>) : null
  }

  /**
   * Get or create the Stripe customer + local record for a user.
   * Optionally pass params forwarded to `stripe.customers.create()`.
   */
  static async createOrGet(
    user: unknown,
    params?: Stripe.CustomerCreateParams
  ): Promise<CustomerData> {
    const existing = await Customer.findByUser(user)
    if (existing) return existing

    const userId = extractUserId(user)
    const stripeCustomer = await StripeManager.stripe.customers.create({
      metadata: { strav_user_id: String(userId) },
      ...params,
    })

    const fk = Customer.fk
    const rows = await Customer.sql.unsafe(
      `INSERT INTO "customer" ("${fk}", "stripe_id")
       VALUES ($1, $2)
       RETURNING *`,
      [userId, stripeCustomer.id]
    )
    return Customer.hydrate(rows[0] as Record<string, unknown>)
  }

  /** Update the default payment method on the local record. */
  static async updateDefaultPaymentMethod(
    stripeCustomerId: string,
    paymentMethod: Stripe.PaymentMethod
  ): Promise<void> {
    await Customer.sql`
      UPDATE "customer"
      SET "pm_type" = ${paymentMethod.type},
          "pm_last_four" = ${paymentMethod.card?.last4 ?? null},
          "updated_at" = NOW()
      WHERE "stripe_id" = ${stripeCustomerId}
    `
  }

  /** Create a Stripe SetupIntent for the customer. */
  static async createSetupIntent(
    user: unknown,
    params?: Stripe.SetupIntentCreateParams
  ): Promise<Stripe.SetupIntent> {
    const customer = await Customer.createOrGet(user)
    return StripeManager.stripe.setupIntents.create({
      customer: customer.stripeId,
      ...params,
    })
  }

  /** List all payment methods for a user's Stripe customer. */
  static async paymentMethods(
    user: unknown,
    type: Stripe.PaymentMethodListParams.Type = 'card'
  ): Promise<Stripe.PaymentMethod[]> {
    const customer = await Customer.findByUser(user)
    if (!customer) return []
    const result = await StripeManager.stripe.paymentMethods.list({
      customer: customer.stripeId,
      type,
    })
    return result.data
  }

  /** Detach a payment method from Stripe. */
  static async deletePaymentMethod(paymentMethodId: string): Promise<void> {
    await StripeManager.stripe.paymentMethods.detach(paymentMethodId)
  }

  /** Sync trial_ends_at on the local record. */
  static async updateTrialEndsAt(
    stripeCustomerId: string,
    trialEndsAt: Date | null
  ): Promise<void> {
    await Customer.sql`
      UPDATE "customer"
      SET "trial_ends_at" = ${trialEndsAt},
          "updated_at" = NOW()
      WHERE "stripe_id" = ${stripeCustomerId}
    `
  }

  /** Delete the local customer record. Does NOT delete from Stripe. */
  static async deleteByUser(user: unknown): Promise<void> {
    const userId = extractUserId(user)
    const fk = Customer.fk
    await Customer.sql.unsafe(`DELETE FROM "customer" WHERE "${fk}" = $1`, [userId])
  }

  /** Delete the local customer record by Stripe ID. */
  static async deleteByStripeId(stripeId: string): Promise<void> {
    await Customer.sql`DELETE FROM "customer" WHERE "stripe_id" = ${stripeId}`
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private static hydrate(row: Record<string, unknown>): CustomerData {
    const fk = Customer.fk
    return {
      id: row.id as number,
      userId: row[fk] as string | number,
      stripeId: row.stripe_id as string,
      pmType: (row.pm_type as string) ?? null,
      pmLastFour: (row.pm_last_four as string) ?? null,
      trialEndsAt: (row.trial_ends_at as Date) ?? null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    }
  }
}
