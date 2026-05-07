export const contentStyles = `    /* ========== MAIN CONTENT ========== */
    .main {
      padding: 40px;
      overflow-y: auto;
      width: 100%;
    }

    /* ========== BREADCRUMBS ========== */
    .docs-breadcrumb {
      margin: 0 0 16px 0;
      font-size: 13px;
      color: var(--text-muted);
    }

    .docs-breadcrumb-list {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .docs-breadcrumb-item {
      display: inline-flex;
      align-items: center;
      min-width: 0;
    }

    .docs-breadcrumb-link {
      color: var(--text-secondary);
      text-decoration: none;
      cursor: pointer;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .docs-breadcrumb-link:hover {
      color: var(--primary-color);
      text-decoration: underline;
    }

    .docs-breadcrumb-label {
      color: var(--text-muted);
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .docs-breadcrumb-current {
      color: var(--text-secondary);
      font-weight: 500;
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .docs-breadcrumb-separator {
      color: var(--text-muted);
      user-select: none;
    }

    /* Mobile: keep first + last segments, ellipsise the middle. We cannot
       collapse via DOM at this layer (the resolver feeds the full chain), but
       on narrow screens we hide every link/label between the second and the
       last-but-one entries, leaving the first, an ellipsis, and the current
       page visible. Separators around hidden items are also hidden. */
    @media (max-width: 600px) {
      .docs-breadcrumb-list > .docs-breadcrumb-item:not(:first-child):not(:last-child) {
        display: none;
      }
      .docs-breadcrumb-list > .docs-breadcrumb-separator:nth-child(n+4):not(:nth-last-child(2)) {
        display: none;
      }
      .docs-breadcrumb-list > .docs-breadcrumb-item:first-child + .docs-breadcrumb-separator + .docs-breadcrumb-item:not(:last-child)::after {
        content: ' \\2026 ';
        color: var(--text-muted);
        margin-left: 4px;
      }
      .docs-breadcrumb-link,
      .docs-breadcrumb-label,
      .docs-breadcrumb-current {
        max-width: 140px;
      }
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

    .markdown-content a:not(.heading-anchor) {
      color: var(--primary-color);
      text-decoration: none;
    }

    .markdown-content a:not(.heading-anchor):hover {
      text-decoration: underline;
    }

    /* Heading anchor (#) — hidden by default, fades in on heading hover.
       Muted colour, no underline, no accent. Stripe/Vercel/GitHub pattern. */
    .markdown-content :is(.md-h1, .md-h2, .md-h3, .md-h4, .md-h5, .md-h6) > .heading-anchor {
      display: inline-block;
      margin-right: 8px;
      color: var(--text-muted);
      text-decoration: none;
      opacity: 0;
      transition: opacity 0.15s, color 0.15s;
      font-weight: 400;
    }

    .markdown-content :is(.md-h1, .md-h2, .md-h3, .md-h4, .md-h5, .md-h6):hover > .heading-anchor,
    .markdown-content .heading-anchor:focus-visible {
      opacity: 1;
    }

    .markdown-content .heading-anchor:hover {
      color: var(--text-secondary);
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

    .markdown-content .emoji {
      display: inline-block;
      min-width: 1em;
      line-height: 1;
      vertical-align: -0.12em;
    }

    .markdown-content .docs-component-mount {
      margin: 16px 0;
    }

    .markdown-content .md-code-block {
      background: var(--bg-tertiary);
      border-radius: 6px;
      padding: 16px;
      margin: 16px 0;
      overflow-x: auto;
    }

    .markdown-content .md-code-wrap {
      position: relative;
      margin: 16px 0;
    }

    .markdown-content .copy-code-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--bg-primary);
      color: var(--text-muted);
      padding: 4px 8px;
      font-size: 11px;
      line-height: 16px;
      cursor: pointer;
    }

    .markdown-content .copy-code-btn:hover {
      color: var(--text-primary);
      border-color: var(--primary-color);
    }

    .markdown-content .md-code-block[data-code-toolbar-enhanced="true"] {
      padding-top: 32px;
    }

    .markdown-content .code-block-toolbar {
      position: absolute;
      top: 6px;
      right: 6px;
      left: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 120ms ease;
    }

    .markdown-content pre:hover .code-block-toolbar,
    .markdown-content .code-block-toolbar:focus-within {
      opacity: 1;
    }

    @media (hover: none) {
      .markdown-content .code-block-toolbar {
        opacity: 1;
      }
    }

    .markdown-content .code-block-lang {
      pointer-events: auto;
      font-family: ui-monospace, 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
      font-size: var(--font-size-xs, 11px);
      line-height: 1;
      color: var(--text-muted);
      text-transform: lowercase;
      letter-spacing: 0.02em;
    }

    .markdown-content .code-block-lang[hidden] {
      display: none;
    }

    .markdown-content .code-block-copy {
      pointer-events: auto;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted);
      padding: 2px 8px;
      font-family: ui-monospace, 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
      font-size: var(--font-size-xs, 11px);
      line-height: 16px;
      cursor: pointer;
      transition: color 120ms ease, border-color 120ms ease;
    }

    .markdown-content .code-block-copy:hover,
    .markdown-content .code-block-copy:focus-visible {
      color: var(--text-secondary);
      border-color: var(--text-secondary);
      outline: none;
    }

    .markdown-content .md-code-block code {
      font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
      font-size: 13px;
      line-height: 1.6;
      color: var(--text-primary);
      white-space: pre;
    }

    .markdown-content .token.comment,
    .markdown-content .token.prolog,
    .markdown-content .token.doctype,
    .markdown-content .token.cdata {
      color: var(--text-muted);
    }

    .markdown-content .token.punctuation {
      color: var(--text-secondary);
    }

    .markdown-content .token.property,
    .markdown-content .token.tag,
    .markdown-content .token.boolean,
    .markdown-content .token.number,
    .markdown-content .token.constant,
    .markdown-content .token.symbol {
      color: #b45309;
    }

    .markdown-content .token.selector,
    .markdown-content .token.attr-name,
    .markdown-content .token.string,
    .markdown-content .token.char,
    .markdown-content .token.builtin {
      color: #047857;
    }

    .markdown-content .token.operator,
    .markdown-content .token.entity,
    .markdown-content .token.url,
    .markdown-content .token.variable {
      color: #0f766e;
    }

    .markdown-content .token.atrule,
    .markdown-content .token.attr-value,
    .markdown-content .token.function,
    .markdown-content .token.class-name {
      color: #2563eb;
    }

    .markdown-content .token.keyword {
      color: #7c3aed;
    }

    [data-theme="dark"] .markdown-content .token.property,
    [data-theme="dark"] .markdown-content .token.tag,
    [data-theme="dark"] .markdown-content .token.boolean,
    [data-theme="dark"] .markdown-content .token.number,
    [data-theme="dark"] .markdown-content .token.constant,
    [data-theme="dark"] .markdown-content .token.symbol {
      color: #fcd34d;
    }

    [data-theme="dark"] .markdown-content .token.selector,
    [data-theme="dark"] .markdown-content .token.attr-name,
    [data-theme="dark"] .markdown-content .token.string,
    [data-theme="dark"] .markdown-content .token.char,
    [data-theme="dark"] .markdown-content .token.builtin {
      color: #86efac;
    }

    [data-theme="dark"] .markdown-content .token.function,
    [data-theme="dark"] .markdown-content .token.class-name {
      color: #93c5fd;
    }

    [data-theme="dark"] .markdown-content .token.keyword {
      color: #c4b5fd;
    }

    .markdown-content .mermaid {
      margin: 16px 0;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg-primary);
      overflow-x: auto;
      text-align: center;
    }

    .markdown-content .mermaid-fallback,
    .markdown-content .mermaid-error {
      text-align: left;
      white-space: pre;
      font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
      font-size: 13px;
      color: var(--text-muted);
    }

    .markdown-content .mermaid-error {
      border-left: 4px solid #d97706;
    }

    .markdown-content .md-image {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 16px 0;
      border-radius: 6px;
      border: 1px solid var(--border);
      cursor: zoom-in;
    }

    .markdown-content .md-image[data-no-zoom="true"],
    .markdown-content .md-image.no-zoom {
      cursor: default;
    }

    .markdown-content .markdown-disabled {
      color: var(--text-muted);
      cursor: not-allowed;
      text-decoration: none;
      opacity: 0.68;
    }

    .image-zoom-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
      background: rgba(15, 23, 42, 0.82);
      cursor: zoom-out;
    }

    .image-zoom-img {
      max-width: min(100%, 1200px);
      max-height: 90vh;
      border-radius: 6px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      cursor: default;
    }

    .image-zoom-close {
      position: fixed;
      top: 18px;
      right: 18px;
      width: 36px;
      height: 36px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 50%;
      background: rgba(15, 23, 42, 0.75);
      color: #fff;
      font-size: 24px;
      line-height: 1;
      cursor: pointer;
    }

    .markdown-content .md-hr {
      border: 0;
      border-top: 1px solid var(--border);
      margin: 24px 0;
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

    .markdown-content .md-alert {
      border: 1px solid var(--border);
      border-left: 4px solid var(--primary-color);
      border-radius: 6px;
      padding: 12px 14px;
      margin: 16px 0;
      background: var(--bg-secondary);
    }

    .markdown-content .md-alert-title {
      color: var(--text-primary);
      font-weight: 600;
      margin-bottom: 6px;
    }

    .markdown-content .md-alert-warning,
    .markdown-content .md-alert-danger,
    .markdown-content .md-alert-caution,
    .markdown-content .md-alert-important {
      border-left-color: #d97706;
    }

    .markdown-content .md-tabs {
      border: 1px solid var(--border);
      border-radius: 6px;
      margin: 16px 0;
      overflow: hidden;
      background: var(--bg-primary);
    }

    .markdown-content .md-tab-list {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
      overflow-x: auto;
    }

    .markdown-content .md-tab-button {
      border: 0;
      border-right: 1px solid var(--border);
      background: transparent;
      color: var(--text-muted);
      padding: 10px 14px;
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
    }

    .markdown-content .md-tab-button.active {
      background: var(--bg-primary);
      color: var(--text-primary);
      font-weight: 600;
    }

    .markdown-content .md-tab-panel {
      display: none;
      padding: 16px;
    }

    .markdown-content .md-tab-panel.active {
      display: block;
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

    .docs-page-result {
      display: block;
      width: 100%;
      padding: 14px 16px;
      margin: 10px 0;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: var(--bg-color);
      color: var(--text-color);
      text-align: left;
      cursor: pointer;
    }

    .docs-page-result:hover {
      border-color: var(--primary-color);
      background: var(--hover-bg);
    }

    .docs-page-result-title {
      display: block;
      font-weight: 600;
    }

    .docs-page-result-desc {
      display: block;
      margin-top: 4px;
      color: var(--text-muted);
      font-size: 14px;
    }

    .docs-pagination {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid var(--border-color);
    }

    .docs-pagination-link {
      min-height: 76px;
      padding: 14px 16px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: var(--bg-color);
      color: var(--text-color);
      text-align: left;
      cursor: pointer;
    }

    .docs-pagination-link:hover {
      border-color: var(--primary-color);
      background: var(--hover-bg);
    }

    .docs-pagination-next {
      text-align: right;
      justify-self: end;
      width: 100%;
    }

    .docs-pagination-label {
      display: block;
      color: var(--text-muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .docs-pagination-title {
      display: block;
      margin-top: 6px;
      font-weight: 600;
    }

    /* Issue #123: Previous / Next page-nav cards.
       Uses only existing tokens (--border-color, --text-secondary,
       --text-primary). No shadows, no pill radius. */
    .page-nav-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid var(--border-color);
    }

    .page-nav-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 76px;
      padding: 14px 16px;
      border: 1px solid var(--border-color);
      background: transparent;
      color: var(--text-primary);
      text-align: left;
      cursor: pointer;
      font: inherit;
    }

    .page-nav-card:hover,
    .page-nav-card:focus-visible {
      border-color: var(--text-primary);
    }

    .page-nav-card-next {
      text-align: right;
      align-items: flex-end;
    }

    .page-nav-eyebrow {
      display: block;
      color: var(--text-secondary);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .page-nav-title {
      display: block;
      color: var(--text-primary);
      font-weight: 600;
    }

    @media (max-width: 720px) {
      .page-nav-grid {
        grid-template-columns: 1fr;
      }
      .page-nav-card-prev {
        order: 0;
      }
      .page-nav-card-next {
        order: 1;
        text-align: left;
        align-items: flex-start;
      }
    }

`
