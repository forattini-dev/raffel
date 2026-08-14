declare const conversationId: string
declare const userPrompt: string

declare function applyOrderUpdate(update: unknown): void
declare function reportDisconnected(): void
declare function appendText(text: string): void
declare function recordUsage(item: unknown): void
declare function finishMessage(item: unknown): void
declare function markCancelled(reason: string): void
declare function showSafeError(item: unknown): void
