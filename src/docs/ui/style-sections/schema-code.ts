export const schemaCodeStyles = `    /* ========== RESPONSE SAMPLES (Right Panel) ========== */
    .response-samples {
      margin-top: 16px;
    }

    .response-samples-header {
      font-size: 12px;
      font-weight: 600;
      color: var(--code-panel-text);
      margin-bottom: 12px;
    }

    .sample-tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 12px;
    }

    .sample-tab {
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.2);
      color: var(--code-panel-text);
      transition: all 0.15s;
    }

    .sample-tab:hover {
      background: rgba(255,255,255,0.1);
    }

    .sample-tab.active {
      background: rgba(255,255,255,0.15);
      border-color: rgba(255,255,255,0.3);
    }

    .sample-tab.status-2xx { color: #10b981; border-color: #10b981; }
    .sample-tab.status-4xx { color: #f59e0b; border-color: #f59e0b; }
    .sample-tab.status-5xx { color: #ef4444; border-color: #ef4444; }

    .sample-content {
      display: none;
    }

    .sample-content.active {
      display: block;
    }

    .sample-content-type {
      font-size: 11px;
      color: #90a4ae;
      margin-bottom: 8px;
    }

    .sample-actions {
      display: flex;
      gap: 12px;
      margin-bottom: 8px;
    }

    .sample-action {
      font-size: 11px;
      color: #90a4ae;
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      transition: color 0.15s;
    }

    .sample-action:hover {
      color: white;
    }

    .sample-json {
      background: rgba(0,0,0,0.3);
      border-radius: 6px;
      padding: 10px;
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 11px;
      line-height: 1.4;
      color: #e2e8f0;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .sample-json .json-key { color: #f8b500; }
    .sample-json .json-string { color: #a5d6a7; }
    .sample-json .json-number { color: #82aaff; }
    .sample-json .json-boolean { color: #f78c6c; }
    .sample-json .json-null { color: #89ddff; }

    /* Right panel sections */
    .right-panel-content {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .right-section {
      margin-bottom: 0;
    }

    .right-section-header {
      font-size: 11px;
      font-weight: 600;
      color: #90a4ae;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }

    .sample-contents {
      margin-top: 0;
    }

    .tab-status {
      font-weight: 600;
    }

    .tab-status.status-2xx { color: #10b981; }
    .tab-status.status-4xx { color: #f59e0b; }
    .tab-status.status-5xx { color: #ef4444; }

    .no-example {
      color: #90a4ae;
      font-style: italic;
      font-size: 13px;
      padding: 12px;
      background: rgba(0,0,0,0.2);
      border-radius: 6px;
    }

    .response-desc-only {
      color: #90a4ae;
      font-size: 13px;
      padding: 12px;
      background: rgba(0,0,0,0.2);
      border-radius: 6px;
    }

    /* ========== CODE EXAMPLES ========== */
    .code-example {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 6px;
      overflow: hidden;
      margin-bottom: 16px;
    }

    .code-example-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      background: var(--code-panel-header);
      font-size: 11px;
      font-weight: 600;
      color: #90a4ae;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .code-example pre {
      margin: 0;
      background: transparent;
      border: none;
      border-radius: 0;
      color: #e2e8f0;
      padding: 10px;
    }

    .code-example code {
      color: #e2e8f0;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 11px;
      line-height: 1.4;
    }

    /* Code language tabs */
    .code-tabs {
      display: flex;
      gap: 2px;
      padding: 6px 10px;
      background: var(--code-panel-header);
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }

    .code-tab {
      padding: 4px 9px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: #90a4ae;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }

    .code-tab:hover {
      background: rgba(255,255,255,0.1);
      color: var(--code-panel-text);
    }

    .code-tab.active {
      background: rgba(255,255,255,0.15);
      color: var(--code-panel-text);
    }

    .code-contents {
      padding: 0;
    }

    .code-content {
      display: none;
    }

    .code-content.active {
      display: block;
    }

    pre {
      background: var(--code-bg);
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
      font-family: 'SF Mono', 'Fira Code', 'Monaco', monospace;
      font-size: 11px;
      line-height: 1.45;
      border: 1px solid var(--border-color);
    }

    /* ========== SCHEMA VISUALIZATION (Redoc-style) ========== */
    .schema-container {
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 16px;
    }

    .schema-row {
      display: flex;
      align-items: flex-start;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color);
      transition: background 0.15s;
    }

    .schema-row:last-child { border-bottom: none; }
    .schema-row:hover { background: var(--hover-bg); }

    .schema-row.nested {
      padding-left: 32px;
      background: rgba(0,0,0,0.02);
    }

    .schema-row.nested-2 { padding-left: 48px; }
    .schema-row.nested-3 { padding-left: 64px; }
    .schema-row.nested-4 { padding-left: 80px; }

    .schema-property {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 200px;
      flex-shrink: 0;
    }

    .schema-name {
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-color);
    }

    .schema-required {
      color: #ef4444;
      font-weight: 700;
      font-size: 12px;
    }

    .schema-type {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 10px;
      font-weight: 500;
    }

    .type-string { background: #dbeafe; color: #1d4ed8; }
    .type-number, .type-integer { background: #fef3c7; color: #b45309; }
    .type-boolean { background: #fce7f3; color: #be185d; }
    .type-object { background: #e0e7ff; color: #4338ca; }
    .type-array { background: #d1fae5; color: #047857; }
    .type-null { background: #f3f4f6; color: #6b7280; }
    .type-ref { background: #fef3c7; color: #92400e; font-style: italic; }

    [data-theme="dark"] .type-string { background: #1e3a5f; color: #93c5fd; }
    [data-theme="dark"] .type-number, [data-theme="dark"] .type-integer { background: #451a03; color: #fcd34d; }
    [data-theme="dark"] .type-boolean { background: #4a0519; color: #f9a8d4; }
    [data-theme="dark"] .type-object { background: #312e81; color: #c7d2fe; }
    [data-theme="dark"] .type-array { background: #064e3b; color: #6ee7b7; }
    [data-theme="dark"] .type-null { background: #374151; color: #9ca3af; }
    [data-theme="dark"] .type-ref { background: #451a03; color: #fbbf24; }

    .schema-details {
      flex: 1;
      padding-left: 16px;
    }

    .schema-desc {
      color: var(--text-muted);
      font-size: 12px;
      margin-bottom: 4px;
    }

    /* Compact ReDoc-style contract tree. Names and requiredness stay in a
       narrow left rail; type, examples, constraints and prose share the
       wider detail column. */
    .schema-tree-root {
      margin-top: 4px;
      border-left: 1px solid var(--border-color);
      border-left-color: color-mix(in srgb, var(--primary-color) 55%, var(--border-color));
    }

    .schema-tree-nested {
      margin-left: 14px;
      border-left: 1px solid var(--border-color);
    }

    .schema-tree-row {
      position: relative;
      display: grid;
      grid-template-columns: minmax(120px, 28%) minmax(0, 1fr);
      gap: 14px;
      padding: 7px 0 7px 10px;
      border-bottom: 1px solid var(--border-color);
      font-size: 12px;
      line-height: 1.4;
    }

    .schema-tree-row::before {
      position: absolute;
      top: 13px;
      left: 0;
      width: 9px;
      border-top: 1px solid var(--border-color);
      border-top-color: color-mix(in srgb, var(--primary-color) 55%, var(--border-color));
      content: '';
    }

    .schema-tree-key {
      position: relative;
      display: flex;
      min-width: 0;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
      padding-left: 8px;
    }

    .schema-tree-name {
      overflow-wrap: anywhere;
      background: transparent;
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 11px;
      color: var(--text-primary);
      font-weight: 500;
    }

    .schema-tree-required,
    .schema-tree-optional,
    .schema-tree-deprecated {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.35px;
      line-height: 1.35;
      text-transform: uppercase;
    }

    .schema-tree-required {
      color: #ef4444;
    }

    .schema-tree-optional { color: var(--text-muted); }
    .schema-tree-deprecated { color: #d97706; }

    .schema-tree-toggle {
      position: absolute;
      top: -1px;
      left: -8px;
      width: 16px;
      height: 16px;
      padding: 0;
      transform: rotate(0deg);
      border: 0;
      background: transparent;
      color: var(--primary-color);
      cursor: pointer;
      font-size: 16px;
      line-height: 14px;
      transition: transform 120ms ease;
    }

    .schema-tree-toggle.open { transform: rotate(90deg); }

    .schema-tree-details { min-width: 0; }

    .schema-tree-type {
      color: var(--text-muted);
      font-size: 11px;
      line-height: 1.35;
    }

    .schema-tree-description {
      margin-top: 3px;
      color: var(--text-color);
      font-size: 12px;
      line-height: 1.42;
    }

    .schema-tree-description.markdown-content p {
      margin: 0 0 3px;
      color: inherit;
      font-size: inherit;
      line-height: inherit;
    }

    .schema-tree-description.markdown-content p:last-child { margin-bottom: 0; }

    .schema-tree-description.markdown-content ul,
    .schema-tree-description.markdown-content ol {
      margin: 4px 0 2px 16px;
      padding: 0;
    }

    .schema-tree-description.markdown-content li { margin: 1px 0; }

    .schema-tree-example {
      display: flex;
      min-width: 0;
      align-items: baseline;
      gap: 5px;
      margin-top: 2px;
      color: var(--text-muted);
      font-size: 11px;
    }

    .schema-tree-example code {
      overflow: hidden;
      padding: 0 3px;
      border: 1px solid var(--border-color);
      border-radius: 2px;
      background: var(--code-bg);
      color: var(--text-color);
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .schema-tree-items-label {
      display: inline-block;
      margin-top: 3px;
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .schema-tree-children.collapsed { display: none; }

    .schema-tree-meta {
      display: block;
      color: var(--text-secondary);
    }

    .schema-tree-unresolved {
      color: var(--text-muted);
      font-style: italic;
    }

    .schema-constraints {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }

    .schema-constraint {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--code-bg);
      color: var(--text-muted);
      font-family: 'SF Mono', 'Monaco', monospace;
    }

    .schema-enum {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }

    .schema-enum-value {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      background: #fef3c7;
      color: #92400e;
      font-family: 'SF Mono', 'Monaco', monospace;
    }

    [data-theme="dark"] .schema-enum-value {
      background: #451a03;
      color: #fbbf24;
    }

    .schema-default {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .schema-default code {
      background: var(--code-bg);
      padding: 1px 4px;
      border-radius: 3px;
      font-family: 'SF Mono', 'Monaco', monospace;
    }

    .schema-toggle {
      cursor: pointer;
      user-select: none;
      color: var(--primary-color);
      font-size: 12px;
      margin-left: 8px;
    }

    .schema-toggle:hover { text-decoration: underline; }

    .schema-nested-container {
      overflow: hidden;
      transition: max-height 0.3s ease;
    }

    .schema-nested-container.collapsed {
      max-height: 0 !important;
    }

    .schema-example {
      margin-top: 16px;
      background: var(--code-bg);
      border-radius: 8px;
      overflow: hidden;
    }

    .schema-example-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: rgba(0,0,0,0.05);
      border-bottom: 1px solid var(--border-color);
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
    }

    .schema-example-body {
      padding: 12px;
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* Response tabs */
    .response-tabs {
      display: flex;
      gap: 2px;
      margin-bottom: 12px;
      border-bottom: 2px solid var(--border-color);
    }

    .response-tab {
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      background: none;
      color: var(--text-muted);
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      transition: all 0.15s;
    }

    .response-tab:hover { color: var(--text-color); }

    .response-tab.active {
      color: var(--primary-color);
      border-bottom-color: var(--primary-color);
    }

    .response-tab.status-2xx { color: #10b981; }
    .response-tab.status-2xx.active { border-bottom-color: #10b981; }
    .response-tab.status-4xx { color: #f59e0b; }
    .response-tab.status-4xx.active { border-bottom-color: #f59e0b; }
    .response-tab.status-5xx { color: #ef4444; }
    .response-tab.status-5xx.active { border-bottom-color: #ef4444; }

    .response-content { display: none; }
    .response-content.active { display: block; }

    /* Parameters table */
    .params-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }

    .params-table th {
      text-align: left;
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
      background: var(--code-bg);
      border-bottom: 1px solid var(--border-color);
    }

    .params-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
      font-size: 13px;
    }

    .params-table tr:last-child td { border-bottom: none; }

    .param-name {
      font-family: 'SF Mono', 'Monaco', monospace;
      font-weight: 600;
    }

    .param-in {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--code-bg);
      color: var(--text-muted);
      text-transform: uppercase;
      margin-left: 8px;
    }

    /* ========== CHANNEL TYPES ========== */
    .channel-type-public { background: #10b981; color: white; }
    .channel-type-private { background: #f59e0b; color: white; }
    .channel-type-presence { background: #8b5cf6; color: white; }

    /* ========== INFO GRID ========== */
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }

    .info-card {
      background: var(--code-bg);
      padding: 16px;
      border-radius: 10px;
      border: 1px solid var(--border-color);
    }

    .info-card-title {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    .info-card-value {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-color);
    }

    /* ========== RESPONSIVE ========== */
    @media (max-width: 900px) {
      .app-container { grid-template-columns: 1fr; }
      .sidebar {
        display: none;
        position: fixed;
        left: 0;
        top: 0;
        width: 300px;
        z-index: 100;
      }
      .sidebar.mobile-open { display: block; }
      .hero { padding: 40px 24px; min-height: 100vh; }
      .hero-logo { height: 80px; margin-bottom: 24px; }
      .hero-title { font-size: 36px; }
      .hero-version { font-size: 12px; margin-left: 8px; }
      .hero-tagline { font-size: 17px; margin-bottom: 20px; }
      .hero-features { flex-direction: column; align-items: center; gap: 12px; }
      .hero-features li { font-size: 15px; }
      .hero-btn { padding: 12px 24px; font-size: 15px; }
      .github-corner svg { width: 60px; height: 60px; }
      .main { padding: 24px; }
    }

    /* ========== ANIMATIONS ========== */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .endpoint-section {
      animation: fadeIn 0.3s ease-out;
    }

    /* ========== HTTP ENDPOINT (ReDoc-style) ========== */
    .http-param-group {
      margin-bottom: 14px;
    }

    .http-param-group-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 0;
      padding-bottom: 5px;
      border-bottom: 1px solid var(--border-color);
    }

    .http-params {
      overflow: visible;
    }

    .http-param {
      padding-top: 7px;
      padding-right: 0;
      padding-bottom: 7px;
    }

    .http-param:last-child { border-bottom: none; }

    .http-param-head {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
    }

    .http-param-name {
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-color);
    }

    .http-param-required {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: #ef4444;
    }

    .http-param-deprecated {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: #f59e0b;
    }

    .http-param-desc {
      color: var(--text-muted);
      font-size: 12px;
      margin-top: 4px;
      line-height: 1.4;
    }

    /* Validation constraint chips (reuses .schema-constraint look) */
    .constraint-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 5px;
    }

    .constraint-chip {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--code-bg);
      color: var(--text-muted);
      border: 1px solid var(--border-color);
      font-family: 'SF Mono', 'Monaco', monospace;
    }

    .constraint-chip.constraint-enum {
      background: #fef3c7;
      color: #92400e;
      border-color: transparent;
    }

    [data-theme="dark"] .constraint-chip.constraint-enum {
      background: #451a03;
      color: #fbbf24;
    }

    /* Response accordions */
    .response-accordion {
      border: 0;
      border-radius: 3px;
      margin-bottom: 8px;
      overflow: hidden;
    }

    .response-accordion-header {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 10px;
      background: var(--code-bg);
      border: none;
      cursor: pointer;
      text-align: left;
      font-size: 12px;
      color: var(--text-color);
      transition: background 0.15s;
    }

    .response-accordion-header:hover { background: var(--hover-bg); }

    .response-accordion-header.status-2xx { background: rgba(16,185,129,0.08); }
    .response-accordion-header.status-3xx { background: rgba(59,130,246,0.08); }
    .response-accordion-header.status-4xx { background: rgba(245,158,11,0.09); }
    .response-accordion-header.status-5xx { background: rgba(239,68,68,0.09); }

    .response-accordion-caret {
      flex-shrink: 0;
      font-size: 10px;
      color: var(--text-muted);
      transition: transform 0.2s ease;
    }

    .response-accordion.open .response-accordion-caret {
      transform: rotate(90deg);
    }

    .response-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .response-status-dot.status-2xx { background: #10b981; }
    .response-status-dot.status-3xx { background: #3b82f6; }
    .response-status-dot.status-4xx { background: #f59e0b; }
    .response-status-dot.status-5xx { background: #ef4444; }

    .response-status-code {
      font-family: 'SF Mono', 'Monaco', monospace;
      font-weight: 600;
    }

    .response-status-desc {
      color: var(--text-muted);
    }

    .response-accordion-body {
      padding: 9px 8px 5px;
      border-top: 0;
      display: none;
    }

    .response-accordion.open .response-accordion-body { display: block; }

    .response-subhead {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin: 0;
      padding-bottom: 5px;
      border-bottom: 1px solid var(--border-color);
    }

    .response-block + .response-block { margin-top: 10px; }

    @media (max-width: 640px) {
      .schema-tree-row {
        grid-template-columns: minmax(100px, 35%) minmax(0, 1fr);
        gap: 8px;
      }
    }

    /* Multi-language code samples */
    .http-code-samples {
      margin-top: 8px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
      background: var(--code-bg);
    }

    .http-code-samples .code-tabs {
      flex-wrap: wrap;
      background: rgba(0,0,0,0.04);
    }

    [data-theme="dark"] .http-code-samples .code-tabs {
      background: rgba(255,255,255,0.03);
    }

    .http-code-sample-pre {
      margin: 0;
      padding: 10px;
      background: transparent;
      border: none;
      border-radius: 0;
      overflow-x: auto;
      font-family: 'SF Mono', 'Fira Code', 'Monaco', monospace;
      font-size: 11px;
      line-height: 1.4;
      color: var(--text-color);
      white-space: pre;
    }

    .http-code-copy,
    .sample-code-copy {
      margin-left: auto;
      padding: 3px 8px;
      background: transparent;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      color: var(--text-muted);
      font-size: 10px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .http-code-copy:hover,
    .sample-code-copy:hover {
      color: #fff;
      border-color: #90a4ae;
    }

    /* Right panel (third column): keep request/response samples dark & legible
       regardless of the active theme, matching ReDoc's sample column. */
    .endpoint-right .endpoint-right-section + .endpoint-right-section {
      margin-top: 18px;
    }

    .endpoint-right .http-code-samples {
      background: rgba(0,0,0,0.25);
      border-color: rgba(255,255,255,0.1);
    }

    .endpoint-right .http-code-samples .code-tabs {
      background: rgba(0,0,0,0.2);
      border-color: rgba(255,255,255,0.1);
    }

    .endpoint-right .http-code-sample-pre {
      color: var(--code-panel-text);
    }

    .response-example-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 24px;
      margin: 2px 0 6px;
    }

    .response-example-toolbar .response-example-name {
      margin: 0;
    }

    .endpoint-right .sample-code {
      margin: 0;
      padding: 10px;
      overflow-x: auto;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      background: rgba(0,0,0,0.25);
      color: var(--code-panel-text);
      white-space: pre;
      word-break: normal;
    }

    .endpoint-right .sample-code code {
      color: inherit;
      font-family: 'SF Mono', 'Fira Code', 'Monaco', monospace;
      font-size: 11px;
      line-height: 1.4;
      white-space: inherit;
    }

    .endpoint-right .token.comment,
    .endpoint-right .token.prolog,
    .endpoint-right .token.doctype,
    .endpoint-right .token.cdata {
      color: #90a4ae;
    }

    .endpoint-right .token.punctuation { color: #cfd8dc; }

    .endpoint-right .token.property,
    .endpoint-right .token.tag,
    .endpoint-right .token.boolean,
    .endpoint-right .token.number,
    .endpoint-right .token.constant,
    .endpoint-right .token.symbol {
      color: #f8b500;
    }

    .endpoint-right .token.selector,
    .endpoint-right .token.attr-name,
    .endpoint-right .token.string,
    .endpoint-right .token.char,
    .endpoint-right .token.builtin {
      color: #a5d6a7;
    }

    .endpoint-right .token.operator,
    .endpoint-right .token.entity,
    .endpoint-right .token.url,
    .endpoint-right .token.variable {
      color: #89ddff;
    }

    .endpoint-right .token.atrule,
    .endpoint-right .token.attr-value,
    .endpoint-right .token.function,
    .endpoint-right .token.class-name {
      color: #82aaff;
    }

    .endpoint-right .token.keyword { color: #c792ea; }

    .endpoint-right .code-tab {
      color: #90a4ae;
    }

    .endpoint-right .code-tab.active {
      background: rgba(255,255,255,0.12);
      color: #fff;
    }

    .endpoint-right .response-subhead {
      color: #90a4ae;
    }

    /* ========== AUTHENTICATION ========== */
    .authentication-section {
      margin: 28px 36px 36px;
      padding: 24px;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      background: var(--surface-color);
    }

    .authentication-header h2 {
      margin: 4px 0 6px;
      font-size: var(--font-size-h2);
      color: var(--text-primary);
    }

    .authentication-header p,
    .auth-scheme-description,
    .auth-scheme-meta {
      color: var(--text-muted);
      font-size: var(--font-size-small);
    }

    .auth-environment {
      display: grid;
      gap: 6px;
      margin: 18px 0;
    }

    .auth-environment-select,
    .auth-input,
    .auth-operation-body {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: var(--bg-primary);
      color: var(--text-primary);
      font: inherit;
      font-size: var(--font-size-small);
    }

    .auth-operation-body {
      min-height: 112px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--font-size-code);
    }

    .auth-schemes {
      display: grid;
      gap: 12px;
    }

    .auth-scheme {
      padding: 16px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: var(--bg-primary);
    }

    .auth-scheme-title {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 10px;
      color: var(--text-primary);
    }

    .auth-scheme-title span,
    .auth-field-label,
    .auth-status {
      color: var(--text-muted);
      font-size: var(--font-size-xs);
    }

    .auth-form,
    .auth-field {
      display: grid;
      gap: 6px;
    }

    .auth-form { gap: 10px; }

    .auth-oauth-flow {
      display: grid;
      gap: 10px;
      margin: 6px 0;
      padding: 14px;
      border: 1px solid var(--border-color);
      border-radius: 7px;
    }

    .auth-oauth-flow legend {
      padding: 0 6px;
      font-weight: 600;
      font-size: var(--font-size-small);
    }

    .auth-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
    }

    .auth-save,
    .auth-request-token,
    .auth-oauth-token,
    .auth-oauth-authorize,
    .auth-oidc-authorize {
      padding: 7px 12px;
      border: 1px solid var(--primary-color);
      border-radius: 6px;
      background: transparent;
      color: var(--primary-color);
      cursor: pointer;
      font-size: var(--font-size-small);
      font-weight: 600;
    }

    .auth-status-error { color: #dc2626; }

    @media (max-width: 760px) {
      .authentication-section { margin: 20px 16px 28px; padding: 18px; }
    }

    .docs-overview-server-variables {
      width: 100%;
      margin-top: 8px;
      color: var(--text-muted);
      font-size: var(--font-size-xs);
    }

    .docs-overview-server-variables ul {
      display: grid;
      gap: 5px;
      margin-top: 5px;
      list-style: none;
    }

    .docs-overview-server-variables li {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .endpoint-deprecated,
    .http-param-deprecated {
      padding: 2px 6px;
      border: 1px solid #d97706;
      border-radius: 4px;
      color: #b45309;
      font-size: var(--font-size-xs);
      font-weight: 600;
    }

    .response-media-sample + .response-media-sample,
    .request-example + .request-example {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid rgba(255,255,255,0.12);
    }

    .response-example-name {
      margin: 6px 0;
      color: var(--text-muted);
      font-size: var(--font-size-xs);
      font-weight: 600;
    }

    .sample-code-error { color: #fca5a5; }

    .response-link {
      display: grid;
      gap: 4px;
      margin-top: 8px;
      padding: 10px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      font-size: var(--font-size-small);
    }

    .response-link-parameters { white-space: pre-wrap; }

    .http-try {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }

    .http-try-run {
      justify-self: start;
      padding: 7px 12px;
      border: 1px solid #8bc34a;
      border-radius: 6px;
      background: transparent;
      color: #c5e1a5;
      cursor: pointer;
      font-size: var(--font-size-small);
      font-weight: 600;
    }

    .http-try-run:disabled { cursor: wait; opacity: 0.6; }

    .http-try-result {
      max-height: 280px;
      overflow: auto;
      padding: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      color: var(--code-panel-text);
      white-space: pre-wrap;
    }

    .async-contracts {
      margin: 28px 36px;
      padding: 22px;
      border: 1px solid var(--border-color);
      border-radius: 9px;
      background: var(--surface-color);
    }

    .endpoint-left > .async-contracts { margin: 16px 0 0; }

    .async-contracts h2 { font-size: var(--font-size-h3); }
    .async-contracts h3 { margin-top: 14px; font-size: var(--font-size-h5); }
    .async-contract-note { margin: 5px 0 12px; color: var(--text-muted); font-size: var(--font-size-small); }

    .async-contract {
      display: grid;
      gap: 7px;
      margin-top: 8px;
      padding: 10px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
    }

    .async-contract-operation {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: var(--font-size-small);
    }

    @media (max-width: 760px) {
      .async-contracts { margin: 20px 16px; padding: 18px; }
    }

`
