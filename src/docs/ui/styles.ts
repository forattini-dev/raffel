/**
 * USD Documentation UI Styles
 *
 * Generates CSS for the USD documentation UI.
 */

import { adjustColor } from './utils.js'

export interface StylesConfig {
  primaryColor: string
  heroBackgroundCSS: string
}

/**
 * Generate CSS styles for the USD documentation UI
 */
export function generateStyles(config: StylesConfig): string {
  const { primaryColor, heroBackgroundCSS } = config

  return `
    :root {
      --primary-color: ${primaryColor};
      --primary-hover: ${adjustColor(primaryColor, -15)};
      --bg-color: #ffffff;
      --text-color: #1f2937;
      --text-muted: #6b7280;
      --border-color: #e5e7eb;
      --code-bg: #f3f4f6;
      --sidebar-bg: #f9fafb;
      --hover-bg: rgba(99, 102, 241, 0.08);
      --code-panel-bg: #263238;
      --code-panel-text: #cfd8dc;
      --code-panel-header: #37474f;
    }

    [data-theme="dark"] {
      --bg-color: #0f172a;
      --text-color: #f1f5f9;
      --text-muted: #94a3b8;
      --border-color: #334155;
      --code-bg: #1e293b;
      --sidebar-bg: #1e293b;
      --hover-bg: rgba(99, 102, 241, 0.15);
    }

    @media (prefers-color-scheme: dark) {
      [data-theme="auto"] {
        --bg-color: #0f172a;
        --text-color: #f1f5f9;
        --text-muted: #94a3b8;
        --border-color: #334155;
        --code-bg: #1e293b;
        --sidebar-bg: #1e293b;
        --hover-bg: rgba(99, 102, 241, 0.15);
      }
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: var(--bg-color);
      color: var(--text-color);
      line-height: 1.6;
    }

    /* ========== HERO SECTION ========== */
    .hero {
      ${heroBackgroundCSS}
      color: white;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      text-align: center;
    }

    .hero-content {
      max-width: 800px;
      margin: 0 auto;
    }

    .hero-logo {
      height: 64px;
      margin-bottom: 24px;
    }

    .hero-title {
      font-size: 48px;
      font-weight: 700;
      margin-bottom: 16px;
      text-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .hero-tagline {
      font-size: 20px;
      opacity: 0.9;
      margin-bottom: 32px;
      max-width: 600px;
      margin-left: auto;
      margin-right: auto;
    }

    .hero-buttons {
      display: flex;
      gap: 16px;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 48px;
    }

    .hero-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 14px 28px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s;
      border: 2px solid white;
    }

    .hero-btn-primary {
      background: white;
      color: var(--primary-color);
    }

    .hero-btn-primary:hover {
      background: rgba(255,255,255,0.9);
      transform: translateY(-2px);
    }

    .hero-btn-secondary {
      background: transparent;
      color: white;
    }

    .hero-btn-secondary:hover {
      background: rgba(255,255,255,0.1);
    }

    .hero-quicklinks {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      max-width: 900px;
      margin: 0 auto;
    }

    .hero-quicklink {
      background: rgba(255,255,255,0.15);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 20px;
      text-decoration: none;
      color: white;
      text-align: left;
      transition: all 0.2s;
      border: 1px solid rgba(255,255,255,0.2);
    }

    .hero-quicklink:hover {
      background: rgba(255,255,255,0.25);
      transform: translateY(-4px);
    }

    .hero-quicklink-icon {
      font-size: 24px;
      margin-bottom: 8px;
    }

    .hero-quicklink-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .hero-quicklink-desc {
      font-size: 13px;
      opacity: 0.8;
    }

    /* ========== LAYOUT ========== */
    .app-container {
      display: grid;
      grid-template-columns: 300px 1fr;
      min-height: calc(100vh - 300px);
    }

    /* ========== SIDEBAR ========== */
    .sidebar {
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border-color);
      padding: 24px 0;
      overflow-y: auto;
      position: sticky;
      top: 0;
      height: 100vh;
    }

    .sidebar-header {
      padding: 0 20px 20px;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 16px;
    }

    .sidebar-logo {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .sidebar-logo img { height: 32px; }
    .sidebar-logo h1 { font-size: 18px; font-weight: 600; }

    .sidebar-search {
      position: relative;
    }

    .sidebar-search input {
      width: 100%;
      padding: 10px 12px 10px 36px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 14px;
      background: var(--bg-color);
      color: var(--text-color);
      outline: none;
      transition: border-color 0.2s;
    }

    .sidebar-search input:focus {
      border-color: var(--primary-color);
    }

    .sidebar-search::before {
      content: '🔍';
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 14px;
    }

    .protocol-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 20px;
      margin-bottom: 20px;
    }

    .protocol-tab {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      background: var(--code-bg);
      border: 1px solid var(--border-color);
      color: var(--text-color);
      transition: all 0.2s;
    }

    .protocol-tab:hover {
      border-color: var(--primary-color);
    }

    .protocol-tab.active {
      background: var(--primary-color);
      color: white;
      border-color: var(--primary-color);
    }

    .protocol-tab .count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      margin-left: 6px;
      font-size: 10px;
      border-radius: 9px;
      background: rgba(0,0,0,0.15);
    }

    .protocol-tab.active .count {
      background: rgba(255,255,255,0.25);
    }

    /* ========== TAG GROUPS ========== */
    .sidebar-nav {
      padding: 0 12px;
    }

    .tag-group {
      margin-bottom: 8px;
    }

    .tag-group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: all 0.2s;
    }

    .tag-group-header:hover {
      background: var(--hover-bg);
      color: var(--text-color);
    }

    .tag-group-arrow {
      transition: transform 0.2s;
      font-size: 10px;
    }

    .tag-group.collapsed .tag-group-arrow {
      transform: rotate(-90deg);
    }

    .tag-group-count {
      margin-left: auto;
      font-size: 11px;
      color: var(--text-muted);
      font-weight: 400;
    }

    .tag-group-items {
      padding-left: 8px;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }

    .tag-group.collapsed .tag-group-items {
      max-height: 0 !important;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 6px;
      text-decoration: none;
      color: var(--text-color);
      font-size: 14px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .nav-item:hover {
      background: var(--hover-bg);
    }

    .nav-item.active {
      background: var(--primary-color);
      color: white;
    }

    .nav-item-intro {
      margin-bottom: 16px;
      padding: 10px 12px;
      background: var(--surface-color);
      border: 1px solid var(--border-color);
      font-weight: 500;
    }

    .nav-item-intro:hover {
      background: var(--hover-bg);
      border-color: var(--primary-color);
    }

    .nav-item-intro .nav-item-icon {
      font-size: 16px;
    }

    .nav-item-intro .nav-item-text {
      font-size: 14px;
    }

    .nav-item-method {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
      text-transform: uppercase;
      font-family: 'SF Mono', 'Monaco', monospace;
    }

    .method-get { background: #10b981; color: white; }
    .method-post { background: #3b82f6; color: white; }
    .method-put { background: #f59e0b; color: white; }
    .method-patch { background: #8b5cf6; color: white; }
    .method-delete { background: #ef4444; color: white; }
    .method-ws { background: #ec4899; color: white; }
    .method-stream { background: #06b6d4; color: white; }
    .method-rpc { background: #f97316; color: white; }
    .method-grpc { background: #14b8a6; color: white; }

    .nav-item-path {
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 13px;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ========== MAIN CONTENT ========== */
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

    /* ========== RESPONSE SAMPLES (Right Panel) ========== */
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
      .hero-title { font-size: 32px; }
      .hero-tagline { font-size: 16px; }
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

    /* ========== TRY IT OUT ========== */
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
}
