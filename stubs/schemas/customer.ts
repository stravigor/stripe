import { defineSchema, t, Archetype } from '@stravigor/database/schema'

export default defineSchema('customer', {
  archetype: Archetype.Component,
  parents: ['user'],
  fields: {
    stripeId: t.varchar(255).required().unique().index(),
    pmType: t.varchar(50).nullable(),
    pmLastFour: t.varchar(4).nullable(),
    trialEndsAt: t.timestamptz().nullable(),
  },
})
