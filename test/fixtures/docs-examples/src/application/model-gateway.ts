export interface ModelGateway {
  stream(request: {
    prompt: string
    conversationId: string
    signal: AbortSignal
  }): AsyncIterable<
    | { type: 'delta'; text: string }
    | { type: 'usage'; inputTokens: number; outputTokens: number }
    | { type: 'final'; text: string; finishReason: 'stop' | 'length' | 'content_filter' | 'tool' }
  >
}
