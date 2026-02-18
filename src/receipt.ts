import { extractUserId } from '@stravigor/database'
import StripeManager from './stripe_manager.ts'
import type { ReceiptData } from './types.ts'

/**
 * Static helper for managing one-time payment receipts.
 *
 * @example
 * const receipt = await Receipt.create({ user, stripeId: pi.id, amount: 2500, currency: 'usd' })
 * const receipts = await Receipt.findByUser(user)
 */
export default class Receipt {
  private static get sql() {
    return StripeManager.db.sql
  }

  private static get fk() {
    return StripeManager.userFkColumn
  }

  /** Record a one-time payment receipt. */
  static async create(data: {
    user: unknown
    stripeId: string
    amount: number
    currency: string
    description?: string | null
    receiptUrl?: string | null
  }): Promise<ReceiptData> {
    const userId = extractUserId(data.user)
    const fk = Receipt.fk
    const rows = await Receipt.sql.unsafe(
      `INSERT INTO "receipt" ("${fk}", "stripe_id", "amount", "currency", "description", "receipt_url")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        userId,
        data.stripeId,
        data.amount,
        data.currency,
        data.description ?? null,
        data.receiptUrl ?? null,
      ]
    )
    return Receipt.hydrate(rows[0] as Record<string, unknown>)
  }

  /** Find all receipts for a user, newest first. */
  static async findByUser(user: unknown): Promise<ReceiptData[]> {
    const userId = extractUserId(user)
    const fk = Receipt.fk
    const rows = await Receipt.sql.unsafe(
      `SELECT * FROM "receipt" WHERE "${fk}" = $1 ORDER BY "created_at" DESC`,
      [userId]
    )
    return rows.map((r: any) => Receipt.hydrate(r))
  }

  /** Find a receipt by Stripe payment intent ID. */
  static async findByStripeId(stripeId: string): Promise<ReceiptData | null> {
    const rows = await Receipt.sql`
      SELECT * FROM "receipt" WHERE "stripe_id" = ${stripeId} LIMIT 1
    `
    return rows.length > 0 ? Receipt.hydrate(rows[0] as Record<string, unknown>) : null
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private static hydrate(row: Record<string, unknown>): ReceiptData {
    const fk = Receipt.fk
    return {
      id: row.id as number,
      userId: row[fk] as string | number,
      stripeId: row.stripe_id as string,
      amount: row.amount as number,
      currency: row.currency as string,
      description: (row.description as string) ?? null,
      receiptUrl: (row.receipt_url as string) ?? null,
      createdAt: row.created_at as Date,
    }
  }
}
