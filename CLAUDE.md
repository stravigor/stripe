# @stravigor/stripe

Stripe billing integration — subscriptions, one-time charges, checkout sessions, invoices, payment methods, and webhooks. Attach billing capabilities to user models with the billable() mixin.

## Dependencies
- @stravigor/kernel (peer)
- @stravigor/database (peer)
- @stravigor/http (peer)

## Commands
- bun test
- bun run build

## Architecture
- src/stripe_manager.ts — main manager class
- src/stripe_provider.ts — service provider registration
- src/billable.ts — mixin to add billing to ORM models
- src/customer.ts — Stripe customer management
- src/subscription.ts — subscription lifecycle
- src/subscription_builder.ts — fluent subscription creation
- src/subscription_item.ts — individual subscription items
- src/checkout_builder.ts — Stripe checkout session builder
- src/invoice.ts — invoice handling
- src/payment_method.ts — payment method management
- src/receipt.ts — receipt generation
- src/webhook.ts — Stripe webhook handling
- src/types.ts — type definitions
- src/errors.ts — package-specific errors

## Conventions
- Use the billable() mixin on user models — don't call Stripe directly
- Webhook handling is centralized in webhook.ts
- Subscription state changes go through the subscription builder pattern
