import { describe, test, expect, beforeEach } from 'bun:test'
import StripeManager from '../src/stripe_manager.ts'
import { mockConfig, mockDb } from './helpers.ts'

describe('StripeManager', () => {
  beforeEach(() => {
    StripeManager.reset()
  })

  test('initializes from Database and Configuration', () => {
    const { db } = mockDb()
    const config = mockConfig()

    new StripeManager(db, config)

    expect(StripeManager.db).toBe(db)
    expect(StripeManager.config.secret).toBe('sk_test_fake')
    expect(StripeManager.config.key).toBe('pk_test_fake')
    expect(StripeManager.config.currency).toBe('usd')
    expect(StripeManager.stripe).toBeDefined()
  })

  test('derives userFkColumn from userKey config', () => {
    const { db } = mockDb()

    new StripeManager(db, mockConfig({ userKey: 'uid' }))
    expect(StripeManager.userFkColumn).toBe('user_uid')

    StripeManager.reset()

    new StripeManager(db, mockConfig({ userKey: 'id' }))
    expect(StripeManager.userFkColumn).toBe('user_id')
  })

  test('throws ConfigurationError when accessing db before init', () => {
    expect(() => StripeManager.db).toThrow('StripeManager not configured')
  })

  test('throws ConfigurationError when accessing config before init', () => {
    expect(() => StripeManager.config).toThrow('StripeManager not configured')
  })

  test('throws ConfigurationError when accessing stripe without secret', () => {
    const { db } = mockDb()
    new StripeManager(db, mockConfig({ secret: '' }))

    expect(() => StripeManager.stripe).toThrow('STRIPE_SECRET')
  })

  test('reset() clears all state', () => {
    const { db } = mockDb()
    new StripeManager(db, mockConfig())

    expect(StripeManager.db).toBe(db)

    StripeManager.reset()

    expect(() => StripeManager.db).toThrow()
  })

  test('reads URLs from config', () => {
    const { db } = mockDb()
    new StripeManager(
      db,
      mockConfig({
        urls: { success: '/ok', cancel: '/nope' },
      })
    )

    expect(StripeManager.config.urls.success).toBe('/ok')
    expect(StripeManager.config.urls.cancel).toBe('/nope')
  })
})
