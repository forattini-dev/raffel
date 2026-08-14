// src/browser/orders-live.ts
const source = new EventSource('/streams/orders/live?region=br')

source.addEventListener('data', (event) => {
  const message = event as MessageEvent<string>
  applyOrderUpdate(JSON.parse(message.data))
})

source.addEventListener('end', () => source.close())
source.addEventListener('error', () => reportDisconnected())
