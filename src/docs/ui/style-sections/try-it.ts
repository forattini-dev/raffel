export const tryItStyles = `    /* ========== TRY IT OUT ========== */
    .try-it-out {
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
      margin-bottom: 20px;
      overflow: hidden;
    }

    .try-it-out.collapsed .try-it-form {
      display: none;
    }

    .try-it-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      cursor: pointer;
      background: var(--code-panel-header);
      transition: background 0.15s;
    }

    .try-it-header:hover {
      background: rgba(255,255,255,0.1);
    }

    .try-it-title {
      font-size: 13px;
      font-weight: 600;
      color: #90a4ae;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .try-it-toggle {
      background: none;
      border: none;
      color: #90a4ae;
      font-size: 12px;
      cursor: pointer;
      transition: transform 0.2s;
    }

    .try-it-out.collapsed .try-it-toggle {
      transform: rotate(-90deg);
    }

    .try-it-form {
      padding: 16px;
    }

    .try-it-section {
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }

    .try-it-section:last-child {
      border-bottom: none;
    }

    .try-it-section-title {
      font-size: 11px;
      font-weight: 600;
      color: #90a4ae;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }

    .try-it-group {
      margin-bottom: 12px;
    }

    .try-it-group:last-child {
      margin-bottom: 0;
    }

    .try-it-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--code-panel-text);
      margin-bottom: 6px;
    }

    .try-it-required {
      color: #ef4444;
    }

    .try-it-input {
      width: 100%;
      padding: 10px 12px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      color: var(--code-panel-text);
      font-size: 13px;
      font-family: 'SF Mono', 'Monaco', monospace;
      outline: none;
      transition: border-color 0.15s;
    }

    .try-it-input:focus {
      border-color: var(--primary-color);
    }

    .try-it-input::placeholder {
      color: #546e7a;
    }

    .try-it-body {
      width: 100%;
      min-height: 120px;
      padding: 12px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      color: var(--code-panel-text);
      font-size: 12px;
      font-family: 'SF Mono', 'Monaco', monospace;
      line-height: 1.5;
      resize: vertical;
      outline: none;
    }

    .try-it-body:focus {
      border-color: var(--primary-color);
    }

    .try-it-actions {
      margin-top: 16px;
    }

    .try-it-send {
      width: 100%;
      padding: 12px 20px;
      background: var(--primary-color);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }

    .try-it-send:hover:not(:disabled) {
      background: var(--primary-hover);
      transform: translateY(-1px);
    }

    .try-it-send:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .try-it-response {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }

    .try-it-response-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    .try-it-response-status {
      font-size: 14px;
      font-weight: 600;
    }

    .try-it-response-status.status-2xx { color: #10b981; }
    .try-it-response-status.status-4xx { color: #f59e0b; }
    .try-it-response-status.status-5xx { color: #ef4444; }

    .try-it-response-time {
      font-size: 13px;
      color: #90a4ae;
    }

    .try-it-response-headers {
      margin-bottom: 16px;
    }

    .try-it-response-headers-pre {
      background: rgba(0,0,0,0.3);
      padding: 12px;
      border-radius: 6px;
      font-size: 12px;
      line-height: 1.6;
      color: #90a4ae;
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .try-it-loading {
      text-align: center;
      color: #90a4ae;
      padding: 20px;
    }

    .try-it-error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 6px;
      padding: 12px 16px;
      color: #ef4444;
      font-size: 13px;
    }

    /* WebSocket Try It Out */
    .try-it-ws {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      overflow: hidden;
    }

    .try-it-ws-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: rgba(0, 0, 0, 0.15);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 13px;
      color: var(--text-secondary);
    }

    .ws-status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #6b7280;
      transition: background 0.2s ease;
    }

    .ws-status-dot.connected {
      background: #22c55e;
      box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
    }

    .try-it-ws-url {
      display: flex;
      gap: 8px;
      padding: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .try-it-ws-url input {
      flex: 1;
      padding: 10px 14px;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      color: var(--text-primary);
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
    }

    .try-it-ws-url input:focus {
      outline: none;
      border-color: var(--primary-color);
    }

    .try-it-ws-connect {
      padding: 10px 20px;
      background: var(--primary-color);
      color: white;
      border: none;
      border-radius: 6px;
      font-weight: 500;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .try-it-ws-connect:hover {
      filter: brightness(1.1);
    }

    .try-it-ws-connect.connected {
      background: #ef4444;
    }

    .try-it-ws-params {
      padding: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .try-it-ws-params h4 {
      margin: 0 0 12px 0;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .try-it-ws-message {
      padding: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .try-it-ws-message h4 {
      margin: 0 0 12px 0;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .try-it-ws-message textarea {
      width: 100%;
      min-height: 100px;
      padding: 12px;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      color: var(--text-primary);
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      resize: vertical;
      box-sizing: border-box;
    }

    .try-it-ws-message textarea:focus {
      outline: none;
      border-color: var(--primary-color);
    }

    .try-it-ws-send {
      margin-top: 12px;
      padding: 10px 20px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      font-weight: 500;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .try-it-ws-send:hover:not(:disabled) {
      filter: brightness(1.1);
    }

    .try-it-ws-send:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .try-it-ws-log {
      padding: 16px;
    }

    .try-it-ws-log-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .try-it-ws-log-header h4 {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .try-it-ws-clear {
      padding: 4px 10px;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: var(--text-secondary);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .try-it-ws-clear:hover {
      border-color: rgba(255, 255, 255, 0.4);
      color: var(--text-primary);
    }

    .try-it-ws-messages {
      max-height: 300px;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 6px;
      padding: 12px;
    }

    .try-it-ws-msg {
      display: flex;
      gap: 8px;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
    }

    .try-it-ws-msg:last-child {
      border-bottom: none;
    }

    .ws-msg-time {
      color: #6b7280;
      flex-shrink: 0;
    }

    .ws-msg-type {
      flex-shrink: 0;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .ws-msg-content {
      flex: 1;
      color: var(--text-primary);
      word-break: break-all;
      white-space: pre-wrap;
    }

    .try-it-ws-msg-sent .ws-msg-type {
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
    }

    .try-it-ws-msg-received .ws-msg-type {
      background: rgba(34, 197, 94, 0.2);
      color: #4ade80;
    }

    .try-it-ws-msg-system .ws-msg-type {
      background: rgba(107, 114, 128, 0.2);
      color: #9ca3af;
    }

    .try-it-ws-msg-error .ws-msg-type {
      background: rgba(239, 68, 68, 0.2);
      color: #f87171;
    }

    .try-it-ws-msg-error .ws-msg-content {
      color: #f87171;
    }

    .try-it-ws-empty {
      text-align: center;
      color: var(--text-tertiary);
      padding: 24px;
      font-size: 13px;
    }

    /* Streams (SSE) Try It Out */
    .try-it-sse {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      overflow: hidden;
    }

    .try-it-sse-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: rgba(0, 0, 0, 0.15);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 13px;
      color: var(--text-secondary);
    }

    .sse-status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #6b7280;
      transition: background 0.2s ease;
    }

    .sse-status-dot.connected {
      background: #22c55e;
      box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
    }

    .sse-status-dot.connecting {
      background: #f59e0b;
      animation: pulse 1s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .try-it-sse-subscribe {
      padding: 10px 20px;
      background: #8b5cf6;
      color: white;
      border: none;
      border-radius: 6px;
      font-weight: 500;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .try-it-sse-subscribe:hover {
      filter: brightness(1.1);
    }

    .try-it-sse-filter-section {
      padding: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .try-it-sse-filter {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .sse-type-badge {
      padding: 4px 10px;
      background: rgba(139, 92, 246, 0.2);
      border: 1px solid rgba(139, 92, 246, 0.4);
      border-radius: 4px;
      font-size: 12px;
      color: #a78bfa;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .sse-type-badge:hover {
      background: rgba(139, 92, 246, 0.3);
    }

    .sse-type-badge.inactive {
      background: rgba(107, 114, 128, 0.1);
      border-color: rgba(107, 114, 128, 0.3);
      color: #6b7280;
      text-decoration: line-through;
    }

    .try-it-sse-log-section {
      padding: 16px;
    }

    .try-it-sse-log-section .try-it-section-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .sse-event-count {
      font-weight: normal;
      color: var(--text-tertiary);
      margin-left: 8px;
    }

    .try-it-sse-clear {
      padding: 4px 10px;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: var(--text-secondary);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .try-it-sse-clear:hover {
      border-color: rgba(255, 255, 255, 0.4);
      color: var(--text-primary);
    }

    .try-it-sse-log {
      max-height: 400px;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 6px;
      padding: 12px;
    }

    .try-it-sse-event {
      margin-bottom: 12px;
      padding: 10px 12px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 6px;
      border-left: 3px solid #8b5cf6;
    }

    .try-it-sse-event:last-child {
      margin-bottom: 0;
    }

    .try-it-sse-event-error {
      border-left-color: #ef4444;
    }

    .sse-event-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 12px;
    }

    .sse-event-time {
      color: #6b7280;
    }

    .sse-event-type {
      padding: 2px 8px;
      background: rgba(139, 92, 246, 0.2);
      border-radius: 3px;
      color: #a78bfa;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 10px;
    }

    .try-it-sse-event-error .sse-event-type {
      background: rgba(239, 68, 68, 0.2);
      color: #f87171;
    }

    .sse-event-id {
      color: #6b7280;
      font-family: 'JetBrains Mono', monospace;
    }

    .sse-event-data {
      margin: 0;
      padding: 8px 10px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-primary);
      white-space: pre-wrap;
      word-break: break-all;
      overflow-x: auto;
    }
`
