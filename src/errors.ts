import { StravError } from '@stravigor/kernel'

/** Base error class for all Stripe billing errors. */
export class StripeError extends StravError {}

/** Thrown when webhook signature verification fails. */
export class WebhookSignatureError extends StripeError {
  constructor() {
    super('Stripe webhook signature verification failed.')
  }
}

/** Thrown when a user has no Stripe customer record. */
export class CustomerNotFoundError extends StripeError {
  constructor() {
    super('No Stripe customer found for this user.')
  }
}

/** Thrown when a subscription is not found. */
export class SubscriptionNotFoundError extends StripeError {
  constructor(name: string) {
    super(`No subscription named "${name}" found for this user.`)
  }
}

/** Thrown when a payment method operation fails on Stripe. */
export class PaymentMethodError extends StripeError {}

/** Thrown when a subscription creation fails on Stripe. */
export class SubscriptionCreationError extends StripeError {}
