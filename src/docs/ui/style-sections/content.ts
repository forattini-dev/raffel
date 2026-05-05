export const contentStyles = `    /* ========== MAIN CONTENT ========== */
    .main {
      padding: 40px;
      overflow-y: auto;
      width: 100%;
    }

    .section { margin-bottom: 48px; }

    .section-title {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
      color: var(--text-color);
    }

    .section-desc {
      color: var(--text-muted);
      margin-bottom: 24px;
    }

    /* ========== INTRODUCTION SECTION ========== */
    .intro-section {
      padding: 32px 40px;
      background: var(--surface-color);
      border-bottom: 1px solid var(--border-color);
      margin: -40px -40px 40px -40px;
    }

    .intro-section .markdown-content {
      max-width: 800px;
    }

    .intro-section .markdown-content h2 {
      font-size: 24px;
      font-weight: 600;
      margin: 32px 0 16px 0;
      color: var(--text-color);
    }

    .intro-section .markdown-content h2:first-child {
      margin-top: 0;
    }

    .intro-section .markdown-content p {
      font-size: 16px;
      line-height: 1.7;
      color: var(--text-color);
      margin-bottom: 16px;
    }

    .intro-section .markdown-content ul {
      margin: 16px 0;
      padding-left: 24px;
    }

    .intro-section .markdown-content li {
      font-size: 15px;
      line-height: 1.6;
      color: var(--text-color);
      margin-bottom: 8px;
    }

    .intro-section .markdown-content code {
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 14px;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
    }

    .intro-section .markdown-content pre {
      background: var(--code-bg);
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 16px 0;
    }

    .intro-section .markdown-content strong {
      font-weight: 600;
      color: var(--text-color);
    }

    /* ========== ENDPOINT SECTIONS (Redoc-style) ========== */
    .endpoint-section {
      padding: 32px 0;
      border-bottom: 1px solid var(--border-color);
    }

    .endpoint-section:last-child {
      border-bottom: none;
    }

    .endpoint-header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 20px;
    }

    .endpoint-method-path {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      font-family: 'SF Mono', 'Monaco', monospace;
      letter-spacing: 0.5px;
    }

    .badge-get { background: #10b981; color: white; }
    .badge-post { background: #3b82f6; color: white; }
    .badge-put { background: #f59e0b; color: white; }
    .badge-patch { background: #8b5cf6; color: white; }
    .badge-delete { background: #ef4444; color: white; }

    .endpoint-path {
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 16px;
      font-weight: 500;
      color: var(--text-color);
    }

    .endpoint-title {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--text-color);
    }

    .endpoint-description {
      color: var(--text-muted);
      font-size: 15px;
      line-height: 1.7;
      margin-bottom: 24px;
    }

    /* Markdown content styles */
    .markdown-content {
      color: var(--text-primary);
    }

    .markdown-content .md-h2 {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 24px 0 12px 0;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }

    .markdown-content .md-h3 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 20px 0 10px 0;
    }

    .markdown-content .md-h4 {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary);
      margin: 16px 0 8px 0;
    }

    .markdown-content .md-p {
      margin: 0 0 12px 0;
      color: var(--text-muted);
    }

    .markdown-content .md-list {
      margin: 12px 0;
      padding-left: 24px;
    }

    .markdown-content .md-list li {
      margin: 6px 0;
      color: var(--text-muted);
    }

    .markdown-content .md-inline-code {
      background: var(--bg-tertiary);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
      font-size: 13px;
      color: var(--accent);
    }

    .markdown-content .md-code-block {
      background: var(--bg-tertiary);
      border-radius: 6px;
      padding: 16px;
      margin: 16px 0;
      overflow-x: auto;
    }

    .markdown-content .md-code-block code {
      font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
      font-size: 13px;
      line-height: 1.6;
      color: var(--text-primary);
      white-space: pre;
    }

    .markdown-content .md-table {
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 14px;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--border);
    }

    .markdown-content .md-table td,
    .markdown-content .md-table th {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      text-align: left;
      white-space: nowrap;
    }

    .markdown-content .md-table td:last-child {
      white-space: normal;
    }

    .markdown-content .md-table tr:first-child td {
      font-weight: 600;
      background: var(--bg-tertiary);
      color: var(--text-primary);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .markdown-content .md-table tr:last-child td {
      border-bottom: none;
    }

    .markdown-content .md-table tr:hover:not(:first-child) {
      background: var(--bg-secondary);
    }

    .markdown-content strong {
      color: var(--text-primary);
      font-weight: 600;
    }

    .markdown-content em {
      font-style: italic;
    }

    .endpoint-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
    }

    @media (min-width: 1400px) {
      .endpoint-content {
        grid-template-columns: 55% 45%;
      }
    }

    @media (max-width: 1200px) {
      .endpoint-content {
        grid-template-columns: 1fr;
        gap: 24px;
      }
    }

    .endpoint-left {
      min-width: 0; /* Prevent overflow */
    }

    .endpoint-right {
      position: sticky;
      top: 20px;
      align-self: start;
      min-width: 0; /* Prevent overflow */
      background: var(--code-panel-bg);
      border-radius: 8px;
      padding: 20px;
      color: var(--code-panel-text);
    }

    .endpoint-right-header {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #90a4ae;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }

    @media (max-width: 1200px) {
      .endpoint-right {
        position: static;
      }
    }

    .endpoint-subsection {
      margin-bottom: 28px;
    }

    .endpoint-subsection-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-color);
    }

    .endpoint-subsection p {
      margin-bottom: 12px;
      color: var(--text-color);
    }

    /* ========== REDOC-STYLE PARAMETER LABELS ========== */
    .subsection-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 16px;
    }

    .content-type {
      font-weight: 400;
      color: var(--text-color);
      text-transform: none;
    }

    .auth-value {
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 14px;
      color: var(--text-color);
      margin-left: 8px;
    }

    /* ========== REDOC-STYLE PARAMETERS ========== */
    .param-row {
      display: flex;
      padding: 16px 0;
      border-bottom: 1px solid var(--border-color);
    }

    .param-row:last-child {
      border-bottom: none;
    }

    .param-tree {
      width: 24px;
      display: flex;
      align-items: flex-start;
      padding-top: 4px;
      color: var(--border-color);
    }

    .param-tree-line {
      width: 12px;
      height: 12px;
      border-left: 1px solid var(--border-color);
      border-bottom: 1px solid var(--border-color);
    }

    .param-info {
      flex: 1;
    }

    .param-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 4px;
      flex-wrap: wrap;
    }

    .param-name-text {
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-color);
    }

    .param-required-badge {
      font-size: 11px;
      font-weight: 600;
      color: #ef4444;
      text-transform: lowercase;
    }

    .param-type-info {
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 13px;
      color: var(--text-muted);
    }

    .param-type-info .format {
      color: #8b5cf6;
    }

    .param-constraint {
      display: inline-block;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      background: #fef3c7;
      color: #92400e;
      font-family: 'SF Mono', 'Monaco', monospace;
      margin-left: 4px;
    }

    [data-theme="dark"] .param-constraint {
      background: #451a03;
      color: #fbbf24;
    }

    .param-default {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .param-default code {
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', 'Monaco', monospace;
    }

    .param-example {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .param-example code {
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', 'Monaco', monospace;
    }

    .param-description {
      font-size: 14px;
      color: var(--text-color);
      line-height: 1.5;
      margin-top: 6px;
    }

    /* ========== REDOC-STYLE RESPONSES ========== */
    .response-item {
      border: 1px solid var(--border-color);
      border-radius: 4px;
      margin-bottom: 8px;
      overflow: hidden;
    }

    .response-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      cursor: pointer;
      transition: background 0.15s;
    }

    .response-header:hover {
      background: var(--hover-bg);
    }

    .response-arrow {
      font-size: 10px;
      transition: transform 0.2s;
      color: var(--text-muted);
    }

    .response-item.expanded .response-arrow {
      transform: rotate(90deg);
    }

    .response-status {
      font-size: 14px;
      font-weight: 600;
    }

    .response-status.status-2xx { color: #10b981; }
    .response-status.status-4xx { color: #f59e0b; }
    .response-status.status-5xx { color: #ef4444; }

    .response-desc {
      font-size: 14px;
      color: var(--text-color);
    }

    .response-body {
      display: none;
      padding: 16px;
      border-top: 1px solid var(--border-color);
      background: var(--code-bg);
    }

    .response-item.expanded .response-body {
      display: block;
    }

    .response-schema-label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }

    .response-schema-label .content-type {
      margin-left: 8px;
    }

    .response-headers-section {
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
    }

    .response-headers-label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }

    .response-header-row {
      display: flex;
      align-items: flex-start;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-color);
    }

    .response-header-row:last-child {
      border-bottom: none;
    }

    .response-header-name {
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-color);
      min-width: 180px;
      margin-right: 16px;
    }

    .response-header-info {
      flex: 1;
    }

    .response-header-type {
      font-size: 12px;
      color: var(--primary-color);
      margin-bottom: 4px;
    }

    .response-header-desc {
      font-size: 13px;
      color: var(--text-muted);
    }

    .response-header-required {
      color: #ef4444;
      font-size: 11px;
      margin-left: 8px;
    }

`
