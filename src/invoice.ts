import type Stripe from 'stripe'
import StripeManager from './stripe_manager.ts'
import Customer from './customer.ts'

/**
 * Static helper for Stripe invoice operations.
 *
 * @example
 * const invoices = await Invoice.list(user)
 * const upcoming = await Invoice.upcoming(user)
 * const pdf = await Invoice.pdfUrl('in_xxx')
 */
export default class Invoice {
  /** List invoices for a user. */
  static async list(user: unknown, params?: Stripe.InvoiceListParams): Promise<Stripe.Invoice[]> {
    const customer = await Customer.findByUser(user)
    if (!customer) return []

    const result = await StripeManager.stripe.invoices.list({
      customer: customer.stripeId,
      limit: 24,
      ...params,
    })
    return result.data
  }

  /** Get the upcoming invoice preview (prorations, next charge). */
  static async upcoming(
    user: unknown,
    params?: Stripe.InvoiceRetrieveUpcomingParams
  ): Promise<Stripe.UpcomingInvoice | null> {
    const customer = await Customer.findByUser(user)
    if (!customer) return null

    try {
      return await StripeManager.stripe.invoices.retrieveUpcoming({
        customer: customer.stripeId,
        ...params,
      })
    } catch {
      return null
    }
  }

  /** Retrieve a specific invoice by Stripe ID. */
  static async find(invoiceId: string): Promise<Stripe.Invoice> {
    return StripeManager.stripe.invoices.retrieve(invoiceId)
  }

  /** Get the hosted invoice URL for payment. */
  static async hostedUrl(invoiceId: string): Promise<string | null> {
    const invoice = await StripeManager.stripe.invoices.retrieve(invoiceId)
    return invoice.hosted_invoice_url ?? null
  }

  /** Get the invoice PDF download URL. */
  static async pdfUrl(invoiceId: string): Promise<string | null> {
    const invoice = await StripeManager.stripe.invoices.retrieve(invoiceId)
    return invoice.invoice_pdf ?? null
  }

  /** Void an invoice. */
  static async void_(invoiceId: string): Promise<Stripe.Invoice> {
    return StripeManager.stripe.invoices.voidInvoice(invoiceId)
  }
}
