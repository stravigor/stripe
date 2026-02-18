import type Stripe from 'stripe'
import type { Context, Handler } from '@stravigor/http'
import StripeManager from './stripe_manager.ts'
import Customer from './customer.ts'
import Subscription from './subscription.ts'
import SubscriptionItem from './subscription_item.ts'
import { WebhookSignatureError } from './errors.ts'
import type { WebhookEventHandler } from './types.ts'

/** Registry of custom webhook event handlers. */
const customHandlers = new Map<string, WebhookEventHandler[]>()

/**
 * Register a custom handler for a Stripe webhook event type.
 *
 * @example
 * import { onWebhookEvent } from '@stravigor/stripe/webhook'
 *
 * onWebhookEvent('invoice.payment_failed', async (event) => {
 *   const invoice = event.data.object as Stripe.Invoice
 *   // Send notification to user...
 * })
 */
export function onWebhookEvent(eventType: string, handler: WebhookEventHandler): void {
  const handlers = customHandlers.get(eventType) ?? []
  handlers.push(handler)
  customHandlers.set(eventType, handlers)
}

/**
 * Create a route handler for Stripe webhooks.
 *
 * Verifies the Stripe signature, dispatches built-in handlers to keep
 * local DB in sync, then calls any custom handlers registered via
 * `onWebhookEvent()`.
 *
 * @example
 * import { stripeWebhook } from '@stravigor/stripe/webhook'
 * router.post('/stripe/webhook', stripeWebhook())
 */
export function stripeWebhook(): Handler {
  return async (ctx: Context): Promise<Response> => {
    const signature = ctx.header('stripe-signature')
    if (!signature) {
      return ctx.json({ error: 'Missing stripe-signature header' }, 400)
    }

    const rawBody = await ctx.request.text()
    const webhookSecret = StripeManager.config.webhookSecret

    let event: Stripe.Event
    try {
      event = await StripeManager.stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        webhookSecret
      )
    } catch {
      throw new WebhookSignatureError()
    }

    // Dispatch built-in handlers
    await handleBuiltinEvent(event)

    // Dispatch custom handlers
    const handlers = customHandlers.get(event.type) ?? []
    for (const handler of handlers) {
      await handler(event)
    }

    return ctx.json({ received: true }, 200)
  }
}

// ---------------------------------------------------------------------------
// Built-in event handling: keeps local DB in sync with Stripe
// ---------------------------------------------------------------------------

async function handleBuiltinEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    // ---- Customer Events ----

    case 'customer.updated': {
      const stripeCustomer = event.data.object as Stripe.Customer
      const defaultPm = stripeCustomer.invoice_settings?.default_payment_method
      if (defaultPm && typeof defaultPm !== 'string') {
        await Customer.updateDefaultPaymentMethod(stripeCustomer.id, defaultPm)
      }
      break
    }

    case 'customer.deleted': {
      const stripeCustomer = event.data.object as Stripe.Customer
      const customer = await Customer.findByStripeId(stripeCustomer.id)
      if (customer) {
        // Clean up all local subscription records
        const subs = await Subscription.findByUser(customer.userId)
        for (const sub of subs) {
          await Subscription.delete(sub.id)
        }
        await Customer.deleteByStripeId(stripeCustomer.id)
      }
      break
    }

    // ---- Subscription Events ----

    case 'customer.subscription.created': {
      const stripeSub = event.data.object as Stripe.Subscription
      const customerId =
        typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id
      const customer = await Customer.findByStripeId(customerId)

      if (customer) {
        const existing = await Subscription.findByStripeId(stripeSub.id)
        if (!existing) {
          const name = stripeSub.metadata?.strav_name ?? 'default'
          const localSub = await Subscription.create({
            user: customer.userId,
            name,
            stripeId: stripeSub.id,
            stripeStatus: stripeSub.status,
            stripePriceId: stripeSub.items.data[0]?.price.id ?? null,
            quantity: stripeSub.items.data[0]?.quantity ?? null,
            trialEndsAt: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
          })
          await SubscriptionItem.syncFromStripe(localSub, localSub.id)
        }
      }
      break
    }

    case 'customer.subscription.updated': {
      const stripeSub = event.data.object as Stripe.Subscription

      const endsAt = stripeSub.cancel_at
        ? new Date(stripeSub.cancel_at * 1000)
        : stripeSub.canceled_at
          ? new Date(stripeSub.current_period_end * 1000)
          : null

      await Subscription.syncStripeStatus(stripeSub.id, stripeSub.status, endsAt)

      // Sync items and metadata
      const localSub = await Subscription.findByStripeId(stripeSub.id)
      if (localSub) {
        await SubscriptionItem.syncFromStripe(localSub, localSub.id)

        // Update price_id, quantity, and trial from first item
        const firstItem = stripeSub.items.data[0]
        if (firstItem) {
          await StripeManager.db.sql`
            UPDATE "subscription"
            SET "stripe_price_id" = ${firstItem.price.id},
                "quantity" = ${firstItem.quantity ?? null},
                "trial_ends_at" = ${stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null},
                "updated_at" = NOW()
            WHERE "stripe_id" = ${stripeSub.id}
          `
        }
      }
      break
    }

    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object as Stripe.Subscription
      await Subscription.syncStripeStatus(stripeSub.id, 'canceled', new Date())
      break
    }
  }
}
