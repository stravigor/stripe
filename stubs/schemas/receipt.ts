import { defineSchema, t, Archetype } from '@stravigor/database/schema'

export default defineSchema('receipt', {
  archetype: Archetype.Component,
  parents: ['user'],
  fields: {
    stripeId: t.varchar(255).required().unique().index(),
    amount: t.integer().required(),
    currency: t.varchar(3).required(),
    description: t.text().nullable(),
    receiptUrl: t.text().nullable(),
  },
})
