export const schemaCodeStyles = `    /* ========== RESPONSE SAMPLES (Right Panel) ========== */
    .response-samples {
      margin-top: 20px;
    }

    .response-samples-header {
      font-size: 14px;
      font-weight: 600;
      color: var(--code-panel-text);
      margin-bottom: 12px;
    }

    .sample-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }

    .sample-tab {
      padding: 6px 14px;
      border-radius: 4px;
      font-size: 13px;
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
      font-size: 12px;
      color: #90a4ae;
      margin-bottom: 8px;
    }

    .sample-actions {
      display: flex;
      gap: 16px;
      margin-bottom: 12px;
    }

    .sample-action {
      font-size: 12px;
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
      padding: 14px;
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 12px;
      line-height: 1.5;
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
      gap: 24px;
    }

    .right-section {
      margin-bottom: 0;
    }

    .right-section-header {
      font-size: 13px;
      font-weight: 600;
      color: #90a4ae;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 16px;
      padding-bottom: 8px;
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
      padding: 10px 14px;
      background: var(--code-panel-header);
      font-size: 12px;
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
      padding: 14px;
    }

    .code-example code {
      color: #e2e8f0;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
    }

    /* Code language tabs */
    .code-tabs {
      display: flex;
      gap: 2px;
      padding: 8px 14px;
      background: var(--code-panel-header);
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }

    .code-tab {
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: #90a4ae;
      font-size: 12px;
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
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-family: 'SF Mono', 'Fira Code', 'Monaco', monospace;
      font-size: 13px;
      line-height: 1.5;
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
      padding: 12px 16px;
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
      font-size: 13px;
      font-weight: 600;
      color: var(--text-color);
    }

    .schema-required {
      color: #ef4444;
      font-weight: 700;
      font-size: 14px;
    }

    .schema-type {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 11px;
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
      font-size: 13px;
      margin-bottom: 4px;
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
      margin-bottom: 20px;
    }

    .http-param-group-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    .http-params {
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .http-param {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
    }

    .http-param:last-child { border-bottom: none; }

    .http-param-head {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .http-param-name {
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 13px;
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
      font-size: 13px;
      margin-top: 6px;
      line-height: 1.5;
    }

    /* Validation constraint chips (reuses .schema-constraint look) */
    .constraint-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .constraint-chip {
      font-size: 11px;
      padding: 2px 8px;
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
      border: 1px solid var(--border-color);
      border-radius: 8px;
      margin-bottom: 10px;
      overflow: hidden;
    }

    .response-accordion-header {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 12px 14px;
      background: var(--code-bg);
      border: none;
      cursor: pointer;
      text-align: left;
      font-size: 13px;
      color: var(--text-color);
      transition: background 0.15s;
    }

    .response-accordion-header:hover { background: var(--hover-bg); }

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
      width: 9px;
      height: 9px;
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
      padding: 14px;
      border-top: 1px solid var(--border-color);
      display: none;
    }

    .response-accordion.open .response-accordion-body { display: block; }

    .response-subhead {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin: 0 0 8px;
    }

    .response-block + .response-block { margin-top: 16px; }

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
      padding: 14px;
      background: transparent;
      border: none;
      border-radius: 0;
      overflow-x: auto;
      font-family: 'SF Mono', 'Fira Code', 'Monaco', monospace;
      font-size: 12px;
      line-height: 1.55;
      color: var(--text-color);
      white-space: pre;
    }

    .http-code-copy {
      margin-left: auto;
      padding: 4px 10px;
      background: transparent;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      color: var(--text-muted);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .http-code-copy:hover { color: var(--text-color); border-color: var(--text-muted); }

    /* Right panel (third column): keep request/response samples dark & legible
       regardless of the active theme, matching ReDoc's sample column. */
    .endpoint-right .endpoint-right-section + .endpoint-right-section {
      margin-top: 24px;
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

`
