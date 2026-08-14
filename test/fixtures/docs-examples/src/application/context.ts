import type { Context } from 'raffel'
import type { LongPollChange } from 'raffel/http'
import type { ModelGateway } from './model-gateway.js'
import type { BillingClient } from './billing.js'

export interface OrderUpdate {
  orderId: string
  status: string
}

export interface OrderSubscription extends AsyncIterable<OrderUpdate> {
  close(): Promise<void>
}

export interface OrdersService {
  subscribe(region: string): Promise<OrderSubscription>
}

export interface OrderChangesService {
  waitAfter(
    after: string | null,
    options: { signal: AbortSignal },
  ): Promise<LongPollChange<unknown> | null>
}

export type AppContext = Omit<Context, 'services'> & {
  services: {
    orders: OrdersService
    orderChanges: OrderChangesService
    modelGateway: ModelGateway
    billing: BillingClient
  }
}
