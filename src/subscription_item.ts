import StripeManager from './stripe_manager.ts'
import type { SubscriptionItemData, SubscriptionData } from './types.ts'

/**
 * Static helper for managing subscription item records (multi-plan subscriptions).
 *
 * @example
 * const items = await SubscriptionItem.findBySubscription(sub.id)
 * await SubscriptionItem.add(sub, sub.id, 'price_addon', 2)
 */
export default class SubscriptionItem {
  private static get sql() {
    return StripeManager.db.sql
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Find all items belonging to a subscription. */
  static async findBySubscription(subscriptionId: number): Promise<SubscriptionItemData[]> {
    const rows = await SubscriptionItem.sql`
      SELECT * FROM "subscription_item"
      WHERE "subscription_id" = ${subscriptionId}
      ORDER BY "created_at" ASC
    `
    return rows.map((r: any) => SubscriptionItem.hydrate(r))
  }

  /** Find by Stripe subscription item ID. */
  static async findByStripeId(stripeId: string): Promise<SubscriptionItemData | null> {
    const rows = await SubscriptionItem.sql`
      SELECT * FROM "subscription_item" WHERE "stripe_id" = ${stripeId} LIMIT 1
    `
    return rows.length > 0 ? SubscriptionItem.hydrate(rows[0] as Record<string, unknown>) : null
  }

  // ---------------------------------------------------------------------------
  // Create / Update
  // ---------------------------------------------------------------------------

  /** Create a local subscription item record. */
  static async create(data: {
    subscriptionId: number
    stripeId: string
    stripeProductId: string
    stripePriceId: string
    quantity?: number | null
  }): Promise<SubscriptionItemData> {
    const rows = await SubscriptionItem.sql`
      INSERT INTO "subscription_item"
        ("subscription_id", "stripe_id", "stripe_product_id", "stripe_price_id", "quantity")
      VALUES (${data.subscriptionId}, ${data.stripeId}, ${data.stripeProductId},
              ${data.stripePriceId}, ${data.quantity ?? null})
      RETURNING *
    `
    return SubscriptionItem.hydrate(rows[0] as Record<string, unknown>)
  }

  /** Add a new price/item to an existing Stripe subscription and record it locally. */
  static async add(
    sub: SubscriptionData,
    localSubId: number,
    priceId: string,
    quantity?: number
  ): Promise<SubscriptionItemData> {
    const stripeItem = await StripeManager.stripe.subscriptionItems.create({
      subscription: sub.stripeId,
      price: priceId,
      quantity: quantity ?? 1,
    })

    return SubscriptionItem.create({
      subscriptionId: localSubId,
      stripeId: stripeItem.id,
      stripeProductId:
        typeof stripeItem.price.product === 'string'
          ? stripeItem.price.product
          : stripeItem.price.product.id,
      stripePriceId: stripeItem.price.id,
      quantity: stripeItem.quantity ?? null,
    })
  }

  /** Swap an existing item to a different price. */
  static async swap(item: SubscriptionItemData, newPriceId: string): Promise<void> {
    await StripeManager.stripe.subscriptionItems.update(item.stripeId, {
      price: newPriceId,
      proration_behavior: 'create_prorations',
    })

    await SubscriptionItem.sql`
      UPDATE "subscription_item"
      SET "stripe_price_id" = ${newPriceId}, "updated_at" = NOW()
      WHERE "stripe_id" = ${item.stripeId}
    `
  }

  /** Update quantity for an item on Stripe and locally. */
  static async updateQuantity(item: SubscriptionItemData, quantity: number): Promise<void> {
    await StripeManager.stripe.subscriptionItems.update(item.stripeId, { quantity })

    await SubscriptionItem.sql`
      UPDATE "subscription_item"
      SET "quantity" = ${quantity}, "updated_at" = NOW()
      WHERE "stripe_id" = ${item.stripeId}
    `
  }

  /** Remove an item from the Stripe subscription and delete locally. */
  static async remove(item: SubscriptionItemData): Promise<void> {
    await StripeManager.stripe.subscriptionItems.del(item.stripeId)
    await SubscriptionItem.sql`
      DELETE FROM "subscription_item" WHERE "stripe_id" = ${item.stripeId}
    `
  }

  /** Report metered usage for a subscription item. */
  static async reportUsage(
    item: SubscriptionItemData,
    quantity: number,
    options?: { timestamp?: number }
  ): Promise<void> {
    await StripeManager.stripe.subscriptionItems.createUsageRecord(item.stripeId, {
      quantity,
      ...(options?.timestamp ? { timestamp: options.timestamp } : {}),
    })
  }

  /** Sync all items from Stripe into the local table for a subscription. */
  static async syncFromStripe(sub: SubscriptionData, localSubId: number): Promise<void> {
    const stripeSub = await StripeManager.stripe.subscriptions.retrieve(sub.stripeId, {
      expand: ['items.data.price.product'],
    })

    // Delete existing local items
    await SubscriptionItem.sql`
      DELETE FROM "subscription_item" WHERE "subscription_id" = ${localSubId}
    `

    // Re-create from Stripe data
    for (const item of stripeSub.items.data) {
      await SubscriptionItem.create({
        subscriptionId: localSubId,
        stripeId: item.id,
        stripeProductId:
          typeof item.price.product === 'string' ? item.price.product : item.price.product.id,
        stripePriceId: item.price.id,
        quantity: item.quantity ?? null,
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private static hydrate(row: Record<string, unknown>): SubscriptionItemData {
    return {
      id: row.id as number,
      subscriptionId: row.subscription_id as number,
      stripeId: row.stripe_id as string,
      stripeProductId: row.stripe_product_id as string,
      stripePriceId: row.stripe_price_id as string,
      quantity: (row.quantity as number) ?? null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    }
  }
}
