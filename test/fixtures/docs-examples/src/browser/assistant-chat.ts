// src/browser/assistant-chat.ts
const source = new EventSource(
  `/streams/assistant/chat?conversationId=${conversationId}&prompt=${encodeURIComponent(userPrompt)}`,
)

source.addEventListener('data', event => {
  const message = event as MessageEvent<string>
  const item = JSON.parse(message.data)

  switch (item.type) {
    case 'delta': appendText(item.text); break
    case 'usage': recordUsage(item); break
    case 'final': finishMessage(item); break
    case 'cancelled': markCancelled(item.reason); source.close(); break
    case 'error': showSafeError(item); source.close(); break
  }
})

source.addEventListener('end', () => source.close())
