import { extractUserId } from '@stravigor/database'
import StripeManager from './stripe_manager.ts'
import type { SubscriptionData } from './types.ts'
import { SubscriptionStatus } from './types.ts'

/**
 * Static helper for managing subscription records.
 *
 * @example
 * const sub = await Subscription.findByName(user, 'pro')
 * if (sub && Subscription.active(sub)) { ... }
 */
export default class Subscription {
  private static get sql() {
    return StripeManager.db.sql
  }

  private static get fk() {
    return StripeManager.userFkColumn
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Find a subscription by user + name (e.g. 'default', 'pro'). */
  static async findByName(user: unknown, name: string): Promise<SubscriptionData | null> {
    const userId = extractUserId(user)
    const fk = Subscription.fk
    const rows = await Subscription.sql.unsafe(
      `SELECT * FROM "subscription" WHERE "${fk}" = $1 AND "name" = $2 LIMIT 1`,
      [userId, name]
    )
    return rows.length > 0 ? Subscription.hydrate(rows[0] as Record<string, unknown>) : null
  }

  /** Find all subscriptions for a user. */
  static async findByUser(user: unknown): Promise<SubscriptionData[]> {
    const userId = extractUserId(user)
    const fk = Subscription.fk
    const rows = await Subscription.sql.unsafe(
      `SELECT * FROM "subscription" WHERE "${fk}" = $1 ORDER BY "created_at" DESC`,
      [userId]
    )
    return rows.map((r: any) => Subscription.hydrate(r))
  }

  /** Find by Stripe subscription ID. */
  static async findByStripeId(stripeId: string): Promise<SubscriptionData | null> {
    const rows = await Subscription.sql`
      SELECT * FROM "subscription" WHERE "stripe_id" = ${stripeId} LIMIT 1
    `
    return rows.length > 0 ? Subscription.hydrate(rows[0] as Record<string, unknown>) : null
  }

  // ---------------------------------------------------------------------------
  // Create / Update
  // ---------------------------------------------------------------------------

  /** Create a local subscription record. */
  static async create(data: {
    user: unknown
    name: string
    stripeId: string
    stripeStatus: string
    stripePriceId?: string | null
    quantity?: number | null
    trialEndsAt?: Date | null
    endsAt?: Date | null
  }): Promise<SubscriptionData> {
    const userId = extractUserId(data.user)
    const fk = Subscription.fk
    const rows = await Subscription.sql.unsafe(
      `INSERT INTO "subscription"
         ("${fk}", "name", "stripe_id", "stripe_status", "stripe_price_id", "quantity", "trial_ends_at", "ends_at")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        data.name,
        data.stripeId,
        data.stripeStatus,
        data.stripePriceId ?? null,
        data.quantity ?? null,
        data.trialEndsAt ?? null,
        data.endsAt ?? null,
      ]
    )
    return Subscription.hydrate(rows[0] as Record<string, unknown>)
  }

  /** Update subscription status from a Stripe webhook event. */
  static async syncStripeStatus(
    stripeId: string,
    status: string,
    endsAt?: Date | null
  ): Promise<void> {
    if (endsAt !== undefined) {
      await Subscription.sql`
        UPDATE "subscription"
        SET "stripe_status" = ${status}, "ends_at" = ${endsAt}, "updated_at" = NOW()
        WHERE "stripe_id" = ${stripeId}
      `
    } else {
      await Subscription.sql`
        UPDATE "subscription"
        SET "stripe_status" = ${status}, "updated_at" = NOW()
        WHERE "stripe_id" = ${stripeId}
      `
    }
  }

  // ---------------------------------------------------------------------------
  // Status Checks (pure functions on SubscriptionData)
  // ---------------------------------------------------------------------------

  /** Whether the subscription is valid (active, trialing, or on grace period). */
  static valid(sub: SubscriptionData): boolean {
    return Subscription.active(sub) || Subscription.onTrial(sub) || Subscription.onGracePeriod(sub)
  }

  /** Whether the Stripe status is active, trialing, or past_due. */
  static active(sub: SubscriptionData): boolean {
    return (
      sub.stripeStatus === SubscriptionStatus.Active ||
      sub.stripeStatus === SubscriptionStatus.Trialing ||
      sub.stripeStatus === SubscriptionStatus.PastDue
    )
  }

  /** Whether the subscription is currently in a trial period. */
  static onTrial(sub: SubscriptionData): boolean {
    return sub.trialEndsAt !== null && sub.trialEndsAt.getTime() > Date.now()
  }

  /** Whether the subscription is canceled but still within its grace period. */
  static onGracePeriod(sub: SubscriptionData): boolean {
    return sub.endsAt !== null && sub.endsAt.getTime() > Date.now()
  }

  /** Whether the subscription has been canceled (ends_at is set). */
  static canceled(sub: SubscriptionData): boolean {
    return sub.endsAt !== null
  }

  /** Whether the subscription has ended (canceled and past grace period). */
  static ended(sub: SubscriptionData): boolean {
    return Subscription.canceled(sub) && !Subscription.onGracePeriod(sub)
  }

  /** Whether the subscription is past due. */
  static pastDue(sub: SubscriptionData): boolean {
    return sub.stripeStatus === SubscriptionStatus.PastDue
  }

  /** Whether the subscription is recurring (not trial, not canceled). */
  static recurring(sub: SubscriptionData): boolean {
    return !Subscription.onTrial(sub) && !Subscription.canceled(sub)
  }

  // ---------------------------------------------------------------------------
  // Mutations (Stripe API + local DB)
  // ---------------------------------------------------------------------------

  /** Cancel the subscription at period end (grace period). */
  static async cancel(sub: SubscriptionData): Promise<SubscriptionData> {
    const stripeSub = await StripeManager.stripe.subscriptions.update(sub.stripeId, {
      cancel_at_period_end: true,
    })

    const endsAt = new Date(stripeSub.current_period_end * 1000)
    await Subscription.sql`
      UPDATE "subscription"
      SET "stripe_status" = ${stripeSub.status}, "ends_at" = ${endsAt}, "updated_at" = NOW()
      WHERE "stripe_id" = ${sub.stripeId}
    `
    return { ...sub, stripeStatus: stripeSub.status, endsAt }
  }

  /** Cancel immediately (no grace period). */
  static async cancelNow(sub: SubscriptionData): Promise<SubscriptionData> {
    await StripeManager.stripe.subscriptions.cancel(sub.stripeId)
    const now = new Date()
    await Subscription.sql`
      UPDATE "subscription"
      SET "stripe_status" = 'canceled', "ends_at" = ${now}, "updated_at" = NOW()
      WHERE "stripe_id" = ${sub.stripeId}
    `
    return { ...sub, stripeStatus: 'canceled', endsAt: now }
  }

  /** Resume a canceled-but-on-grace-period subscription. */
  static async resume(sub: SubscriptionData): Promise<SubscriptionData> {
    if (!Subscription.onGracePeriod(sub)) {
      throw new Error('Cannot resume a subscription that is not within its grace period.')
    }

    const stripeSub = await StripeManager.stripe.subscriptions.update(sub.stripeId, {
      cancel_at_period_end: false,
    })

    await Subscription.sql`
      UPDATE "subscription"
      SET "stripe_status" = ${stripeSub.status}, "ends_at" = ${null}, "updated_at" = NOW()
      WHERE "stripe_id" = ${sub.stripeId}
    `
    return { ...sub, stripeStatus: stripeSub.status, endsAt: null }
  }

  /** Swap the subscription to a different price (prorates by default). */
  static async swap(sub: SubscriptionData, newPriceId: string): Promise<SubscriptionData> {
    const stripeSub = await StripeManager.stripe.subscriptions.retrieve(sub.stripeId)
    const itemId = stripeSub.items.data[0]?.id
    if (!itemId) throw new Error('Subscription has no items to swap.')

    const updated = await StripeManager.stripe.subscriptions.update(sub.stripeId, {
      items: [{ id: itemId, price: newPriceId }],
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false,
    })

    await Subscription.sql`
      UPDATE "subscription"
      SET "stripe_price_id" = ${newPriceId},
          "stripe_status" = ${updated.status},
          "ends_at" = ${null},
          "updated_at" = NOW()
      WHERE "stripe_id" = ${sub.stripeId}
    `
    return { ...sub, stripePriceId: newPriceId, stripeStatus: updated.status, endsAt: null }
  }

  /** Update the subscription quantity on Stripe and locally. */
  static async updateQuantity(sub: SubscriptionData, quantity: number): Promise<SubscriptionData> {
    const stripeSub = await StripeManager.stripe.subscriptions.retrieve(sub.stripeId)
    const itemId = stripeSub.items.data[0]?.id
    if (!itemId) throw new Error('Subscription has no items to update quantity for.')

    await StripeManager.stripe.subscriptions.update(sub.stripeId, {
      items: [{ id: itemId, quantity }],
    })

    await Subscription.sql`
      UPDATE "subscription"
      SET "quantity" = ${quantity}, "updated_at" = NOW()
      WHERE "stripe_id" = ${sub.stripeId}
    `
    return { ...sub, quantity }
  }

  /** Delete the local subscription record. */
  static async delete(id: number): Promise<void> {
    await Subscription.sql`DELETE FROM "subscription" WHERE "id" = ${id}`
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private static hydrate(row: Record<string, unknown>): SubscriptionData {
    const fk = Subscription.fk
    return {
      id: row.id as number,
      userId: row[fk] as string | number,
      name: row.name as string,
      stripeId: row.stripe_id as string,
      stripeStatus: row.stripe_status as string,
      stripePriceId: (row.stripe_price_id as string) ?? null,
      quantity: (row.quantity as number) ?? null,
      trialEndsAt: (row.trial_ends_at as Date) ?? null,
      endsAt: (row.ends_at as Date) ?? null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    }
  }
}
