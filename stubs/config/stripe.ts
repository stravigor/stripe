import { env } from '@stravigor/kernel/helpers'

export default {
  /** Stripe secret key. */
  secret: env('STRIPE_SECRET', ''),

  /** Stripe publishable key. */
  key: env('STRIPE_KEY', ''),

  /** Stripe webhook signing secret. */
  webhookSecret: env('STRIPE_WEBHOOK_SECRET', ''),

  /** Default currency for charges. */
  currency: 'usd',

  /**
   * The user model's primary key property (determines FK column name).
   * 'id' → user_id, 'uid' → user_uid, etc.
   */
  userKey: 'id',

  /** URLs for Stripe Checkout success/cancel redirects. */
  urls: {
    success: env('APP_URL', 'http://localhost:3000') + '/billing/success',
    cancel: env('APP_URL', 'http://localhost:3000') + '/billing/cancel',
  },
}
