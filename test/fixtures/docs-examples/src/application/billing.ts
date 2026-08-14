export interface BillingClient {
  charge(input: {
    amount: number
    idempotencyKey: string
    signal: AbortSignal
    deadline?: number
  }): Promise<{ paymentId: string }>
  close(): Promise<void>
}

export const billingConfig = {
  baseUrl: 'https://billing.internal',
  credentials: 'application-owned-secret',
}

export function createBillingClient(_config: typeof billingConfig): BillingClient {
  throw new Error('The application supplies its billing adapter')
}
