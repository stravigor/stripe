import { describe, test, expect, beforeEach } from 'bun:test'
import Customer from '../src/customer.ts'
import {
  bootStripe,
  stripeCustomer,
  stripeSetupIntent,
  stripePaymentMethod,
  customerRow,
} from './helpers.ts'

let sql: ReturnType<typeof bootStripe>

describe('Customer', () => {
  beforeEach(() => {
    sql = bootStripe()
  })

  describe('findByUser', () => {
    test('returns customer data when found', async () => {
      sql.setResult([customerRow()])

      const customer = await Customer.findByUser(1)

      expect(customer).not.toBeNull()
      expect(customer!.stripeId).toBe('cus_test123')
      expect(customer!.userId).toBe(1)
      expect(sql.calls).toHaveLength(1)
      expect(sql.calls[0].type).toBe('unsafe')
    })

    test('returns null when not found', async () => {
      sql.setResult([])

      const customer = await Customer.findByUser(999)

      expect(customer).toBeNull()
    })
  })

  describe('findByStripeId', () => {
    test('returns customer by Stripe ID', async () => {
      sql.setResult([customerRow()])

      const customer = await Customer.findByStripeId('cus_test123')

      expect(customer).not.toBeNull()
      expect(customer!.id).toBe(1)
      expect(sql.calls[0].type).toBe('tagged')
    })

    test('returns null when not found', async () => {
      sql.setResult([])

      const customer = await Customer.findByStripeId('cus_nonexistent')

      expect(customer).toBeNull()
    })
  })

  describe('createOrGet', () => {
    test('returns existing customer if found', async () => {
      sql.setResult([customerRow()])

      const customer = await Customer.createOrGet(1)

      expect(customer.stripeId).toBe('cus_test123')
      // Should have made 1 query (findByUser), no Stripe call
      expect(sql.calls).toHaveLength(1)
    })

    test('creates Stripe customer and local record when not found', async () => {
      // First call: findByUser returns empty
      // Second call: INSERT returns new row
      let callCount = 0
      sql.db.sql.unsafe = (sqlStr: string, params: unknown[]) => {
        sql.calls.push({ type: 'unsafe', sql: sqlStr, params })
        callCount++
        if (callCount === 1) return Promise.resolve([]) // findByUser
        return Promise.resolve([customerRow()]) // INSERT
      }

      sql.stripe.onCall('customers.create', stripeCustomer())

      const customer = await Customer.createOrGet(1)

      expect(customer.stripeId).toBe('cus_test123')
      expect(sql.calls).toHaveLength(2)
      expect(sql.calls[1].sql).toContain('INSERT')
    })
  })

  describe('updateDefaultPaymentMethod', () => {
    test('updates pm_type and pm_last_four', async () => {
      sql.setResult([])

      await Customer.updateDefaultPaymentMethod('cus_test123', {
        type: 'card',
        card: { last4: '4242' },
      } as any)

      expect(sql.calls).toHaveLength(1)
      expect(sql.calls[0].params).toContain('card')
      expect(sql.calls[0].params).toContain('4242')
    })
  })

  describe('createSetupIntent', () => {
    test('creates customer if needed and returns SetupIntent', async () => {
      sql.setResult([customerRow()])
      sql.stripe.onCall('setupIntents.create', stripeSetupIntent())

      const intent = await Customer.createSetupIntent(1)

      expect(intent.id).toBe('seti_test123')
    })
  })

  describe('paymentMethods', () => {
    test('returns empty array when no customer', async () => {
      sql.setResult([])

      const methods = await Customer.paymentMethods(1)

      expect(methods).toEqual([])
    })

    test('lists payment methods when customer exists', async () => {
      sql.setResult([customerRow()])
      sql.stripe.onCall('paymentMethods.list', { data: [stripePaymentMethod()], has_more: false })

      const methods = await Customer.paymentMethods(1)

      expect(methods).toHaveLength(1)
      expect(methods[0].id).toBe('pm_test123')
    })
  })

  describe('deleteByUser', () => {
    test('deletes local record', async () => {
      sql.setResult([])

      await Customer.deleteByUser(1)

      expect(sql.calls).toHaveLength(1)
      expect(sql.calls[0].sql).toContain('DELETE')
    })
  })

  describe('hydrate', () => {
    test('maps snake_case DB row to camelCase', async () => {
      const trialDate = new Date('2025-06-01')
      sql.setResult([
        customerRow({
          pm_type: 'card',
          pm_last_four: '1234',
          trial_ends_at: trialDate,
        }),
      ])

      const customer = await Customer.findByUser(1)

      expect(customer!.pmType).toBe('card')
      expect(customer!.pmLastFour).toBe('1234')
      expect(customer!.trialEndsAt).toEqual(trialDate)
    })
  })
})
