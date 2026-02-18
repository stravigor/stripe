import { defineSchema, t, Archetype } from '@stravigor/database/schema'

export default defineSchema('subscription_item', {
  archetype: Archetype.Component,
  parents: ['subscription'],
  fields: {
    stripeId: t.varchar(255).required().unique().index(),
    stripeProductId: t.varchar(255).required().index(),
    stripePriceId: t.varchar(255).required().index(),
    quantity: t.integer().nullable(),
  },
})
