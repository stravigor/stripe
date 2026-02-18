import { defineSchema, t, Archetype } from '@stravigor/database/schema'

export default defineSchema('subscription', {
  archetype: Archetype.Component,
  parents: ['user'],
  fields: {
    name: t.varchar(255).required().index(),
    stripeId: t.varchar(255).required().unique().index(),
    stripeStatus: t.varchar(50).required(),
    stripePriceId: t.varchar(255).nullable(),
    quantity: t.integer().nullable(),
    trialEndsAt: t.timestamptz().nullable(),
    endsAt: t.timestamptz().nullable(),
  },
})
