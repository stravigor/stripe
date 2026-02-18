import type Stripe from 'stripe'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface StripeConfig {
  /** Stripe secret key. */
  secret: string
  /** Stripe publishable key (passed to frontend). */
  key: string
  /** Stripe webhook signing secret. */
  webhookSecret: string
  /** Default currency code (lowercase). */
  currency: string
  /** The user model's primary key property name (e.g. 'id', 'uid'). */
  userKey: string
  /** URL prefix for Checkout success/cancel. */
  urls: {
    success: string
    cancel: string
  }
}

// ---------------------------------------------------------------------------
// Data Records
// ---------------------------------------------------------------------------

export interface CustomerData {
  id: number
  userId: string | number
  stripeId: string
  pmType: string | null
  pmLastFour: string | null
  trialEndsAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface SubscriptionData {
  id: number
  userId: string | number
  name: string
  stripeId: string
  stripeStatus: string
  stripePriceId: string | null
  quantity: number | null
  trialEndsAt: Date | null
  endsAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface SubscriptionItemData {
  id: number
  subscriptionId: number
  stripeId: string
  stripeProductId: string
  stripePriceId: string
  quantity: number | null
  createdAt: Date
  updatedAt: Date
}

export interface ReceiptData {
  id: number
  userId: string | number
  stripeId: string
  amount: number
  currency: string
  description: string | null
  receiptUrl: string | null
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Subscription Status
// ---------------------------------------------------------------------------

export const SubscriptionStatus = {
  Active: 'active',
  Canceled: 'canceled',
  Incomplete: 'incomplete',
  IncompleteExpired: 'incomplete_expired',
  PastDue: 'past_due',
  Paused: 'paused',
  Trialing: 'trialing',
  Unpaid: 'unpaid',
} as const

export type SubscriptionStatusValue = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus]

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export type WebhookEventHandler = (event: Stripe.Event) => void | Promise<void>
