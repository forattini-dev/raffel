export const layoutNavigationStyles = `    /* ========== LAYOUT ========== */
    .skip-link {
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 1000;
      transform: translateY(-160%);
      padding: 10px 14px;
      border-radius: 6px;
      background: var(--primary-color);
      color: white;
      font-weight: 600;
      text-decoration: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.18);
      transition: transform 0.15s ease;
    }

    .skip-link:focus {
      transform: translateY(0);
      outline: 2px solid white;
      outline-offset: 2px;
    }

    .app-container {
      --sidebar-width: 280px;
      display: grid;
      grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
      min-height: calc(100vh - 300px);
    }

    .app-container-no-sidebar {
      grid-template-columns: 1fr;
    }

    .main-shell {
      display: grid;
      grid-template-columns: 1fr 380px;
      align-items: stretch;
      min-width: 0;
      gap: 0;
    }

    /* Drop the (empty) TOC gutter on endpoint views so the operation's
       two-column content — docs + samples panel — can use the full width. */
    .main-shell.main-shell-no-toc {
      grid-template-columns: minmax(0, 1fr);
    }

    .main-shell.main-shell-no-toc .toc {
      display: none;
    }

    /* ========== SIDEBAR ========== */
    .sidebar {
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      min-width: 0;
      padding: 14px 0 0;
      overflow: visible;
      position: sticky;
      top: 0;
      height: 100vh;
    }

    .sidebar-resizer {
      appearance: none;
      position: absolute;
      top: 0;
      right: -5px;
      z-index: 5;
      width: 10px;
      height: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: col-resize;
      touch-action: none;
    }

    .sidebar-resizer::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 4px;
      width: 1px;
      background: transparent;
      transition: background-color 0.15s, box-shadow 0.15s;
    }

    .sidebar-resizer:hover::before,
    .sidebar-resizer:focus-visible::before,
    html.sidebar-is-resizing .sidebar-resizer::before {
      background: var(--primary-color);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 18%, transparent);
    }

    .sidebar-resizer:focus-visible {
      outline: 0;
    }

    html.sidebar-is-resizing,
    html.sidebar-is-resizing * {
      cursor: col-resize !important;
      user-select: none !important;
    }

    .sidebar-hidden {
      display: none;
    }

    .sidebar-header {
      padding: 0 14px 14px;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 12px;
    }

    .sidebar-logo {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .sidebar-logo img { height: 32px; }
    .sidebar-logo h1 { font-size: 16px; font-weight: 600; }

    .sidebar-search {
      position: relative;
    }

    .sidebar-search input {
      width: 100%;
      padding: 8px 10px 8px 32px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: var(--font-size-small);
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
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      font-size: var(--font-size-small);
    }

    .protocol-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      padding: 0 14px;
      margin-bottom: 14px;
    }

    .protocol-tab {
      padding: 5px 10px;
      border-radius: 20px;
      font-size: 10px;
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
      font-size: 9px;
      border-radius: 9px;
      background: rgba(0,0,0,0.15);
    }

    .protocol-tab.active .count {
      background: rgba(255,255,255,0.25);
    }

    /* ========== TAG GROUPS ========== */
    .sidebar-nav {
      flex: 1;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      padding: 0 10px;
      scrollbar-gutter: stable;
    }

    .tag-group {
      margin-bottom: 8px;
    }

    .tag-group-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      transition: all 0.2s;
    }

    .tag-group-header:hover {
      background: var(--hover-bg);
      color: var(--text-color);
    }

    .tag-group-header.active {
      color: var(--primary-color);
    }

    .tag-group-arrow {
      transition: transform 0.2s;
      font-size: 9px;
    }

    .tag-group.collapsed .tag-group-arrow {
      transform: rotate(-90deg);
    }

    .tag-group-count {
      margin-left: auto;
      font-size: 10px;
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
      gap: 8px;
      padding: 4px 10px 4px 12px;
      border-left: 2px solid transparent;
      border-radius: 0;
      text-decoration: none;
      color: var(--text-secondary);
      font-size: var(--font-size-small);
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }

    .nav-item:hover {
      color: var(--text-primary);
    }

    .nav-item.active {
      color: var(--text-primary);
      border-left-color: var(--primary-color);
      font-weight: 600;
    }

    .nav-subitems {
      display: grid;
      gap: 2px;
      margin: 2px 0 8px 12px;
      padding-left: 12px;
      border-left: 1px solid var(--border-color);
    }

    .nav-subitem {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      font: inherit;
      font-size: 10px;
      line-height: 1.35;
      padding: 4px 7px;
      text-align: left;
      border-radius: 5px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .nav-subitem-level-3,
    .nav-subitem-level-4,
    .nav-subitem-level-5,
    .nav-subitem-level-6 {
      margin-left: 10px;
    }

    .nav-subitem:hover {
      color: var(--text-primary);
    }

    .nav-subitem.active {
      color: var(--text-primary);
      font-weight: 600;
      box-shadow: inset 2px 0 0 var(--primary-color);
    }

    .docs-sidebar-depth-1 { margin-left: 4px; }
    .docs-sidebar-depth-2 { margin-left: 10px; }
    .docs-sidebar-depth-3,
    .docs-sidebar-depth-4,
    .docs-sidebar-depth-5,
    .docs-sidebar-depth-6 { margin-left: 16px; }

    .nav-item-intro {
      margin-bottom: 12px;
      padding: 8px 10px;
      background: var(--surface-color);
      border: 1px solid var(--border-color);
      font-weight: 500;
    }

    .nav-item-intro:hover {
      background: var(--hover-bg);
      border-color: var(--primary-color);
    }

    .nav-item-intro .nav-item-icon {
      font-size: 14px;
    }

    .nav-item-intro .nav-item-text {
      font-size: 12px;
    }

    .nav-item-method {
      font-size: 9px;
      font-weight: 600;
      padding: 1px 4px;
      border: 1px solid var(--border-color);
      border-radius: 2px;
      text-transform: uppercase;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--text-secondary);
      background: transparent;
      letter-spacing: 0.02em;
    }

    /* HTTP methods share the endpoint-content palette so long route lists
       remain scannable without adding size or spacing. */
    .method-get { background: var(--method-get-color); color: white; border-color: var(--method-get-color); }
    .method-post { background: var(--method-post-color); color: white; border-color: var(--method-post-color); }
    .method-put { background: var(--method-put-color); color: white; border-color: var(--method-put-color); }
    .method-patch { background: var(--method-patch-color); color: white; border-color: var(--method-patch-color); }
    .method-delete { background: var(--method-delete-color); color: white; border-color: var(--method-delete-color); }

    .method-ws,
    .method-stream,
    .method-rpc,
    .method-grpc {
      color: var(--text-secondary);
      background: transparent;
      border-color: var(--border-color);
    }

    .nav-item-path {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .nav-item-text,
    .docs-sidebar-home {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ========== Floating utility buttons (theme toggle, back-to-top) ========== */
    .icon-button {
      appearance: none;
      background: transparent;
      color: var(--text-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 4px 10px;
      font-size: var(--font-size-small);
      font-family: inherit;
      font-weight: 500;
      cursor: pointer;
      line-height: 1.2;
      transition: color 0.15s, border-color 0.15s;
    }

    .icon-button:hover {
      color: var(--text-primary);
      border-color: var(--text-secondary);
    }

    .icon-button:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }

    .back-to-top {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 50;
      appearance: none;
      background: var(--bg-color);
      color: var(--text-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 6px 12px;
      font-size: var(--font-size-small);
      font-family: inherit;
      font-weight: 500;
      cursor: pointer;
      line-height: 1.2;
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px);
      transition: opacity 0.2s, transform 0.2s, color 0.15s, border-color 0.15s;
    }

    .back-to-top.visible {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }

    .back-to-top::before {
      content: '\\2191';
      margin-right: 6px;
      font-weight: 400;
    }

    .back-to-top:hover {
      color: var(--text-primary);
      border-color: var(--text-secondary);
    }

    .back-to-top:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }

    @media (max-width: 1200px) {
      .main-shell {
        grid-template-columns: 1fr;
      }
      .toc {
        display: none;
      }
    }

    .docs-pages-group > .tag-group-header {
      color: var(--text-primary);
      background: var(--hover-bg);
      border-left: 3px solid var(--primary-color);
      padding-left: 9px;
      margin-bottom: 4px;
      letter-spacing: 0.01em;
    }

    .docs-pages-group > .tag-group-header:hover {
      background: var(--hover-bg);
      opacity: 0.85;
    }

    .docs-sidebar-home {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .docs-sidebar-home-icon {
      flex-shrink: 0;
      opacity: 0.7;
    }

    /* ========== TOC / TRY IT OUT PANEL (ReDoc-style right panel) ========== */
    .toc {
      align-self: stretch;
      position: sticky;
      top: 0;
      padding: 24px;
      border-left: 1px solid var(--border-color);
      font-size: var(--font-size-small);
      line-height: 1.5;
      max-height: 100vh;
      overflow-y: auto;
      background: #263238;
      color: #eceff1;
    }

    [data-theme="light"] .toc {
      background: #f5f7fa;
      color: #263238;
      border-left-color: #e0e0e0;
    }

    .toc:empty {
      border: 0;
      padding: 0;
    }

    .toc-title {
      color: #90caf9;
      font-size: var(--font-size-xs);
      font-weight: 600;
      letter-spacing: 0.04em;
      margin: 0 0 16px;
      text-transform: uppercase;
    }

    [data-theme="light"] .toc-title {
      color: #1976d2;
    }

    .toc-link {
      display: block;
      padding: 6px 0;
      color: #b0bec5;
      text-decoration: none;
      border-left: 3px solid transparent;
      margin-left: -24px;
      padding-left: 21px;
      transition: color 0.15s, border-color 0.15s;
      font-family: 'SF Mono', 'Monaco', monospace;
      font-size: 11px;
    }

    .toc-link:hover {
      color: #e0e0e0;
      border-left-color: #90caf9;
    }

    [data-theme="light"] .toc-link {
      color: #666;
    }

    [data-theme="light"] .toc-link:hover {
      color: #263238;
      border-left-color: #1976d2;
    }

    .toc-link.active {
      color: #e0e0e0;
      border-left-color: #90caf9;
      font-weight: 600;
    }

    [data-theme="light"] .toc-link.active {
      color: #263238;
      border-left-color: #1976d2;
    }

    .toc-level-2 { padding-left: 27px; }
    .toc-level-3 { padding-left: 39px; }
    .toc-level-4 { padding-left: 51px; }
    .toc-level-5 { padding-left: 63px; }
    .toc-level-6 { padding-left: 75px; }
    /* ========== SEARCH MODAL (cmd+K) ========== */
    dialog.search-modal {
      padding: 0;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      background: var(--bg-color);
      color: var(--text-color);
      width: min(640px, calc(100vw - 32px));
      max-width: 640px;
      max-height: 70vh;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      margin: auto;
    }

    dialog.search-modal::backdrop {
      background: rgba(0, 0, 0, 0.45);
    }

    dialog.search-modal:not([open]) {
      display: none;
    }

    .search-modal-inner {
      display: flex;
      flex-direction: column;
      max-height: 70vh;
    }

    .search-modal-input-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-color);
    }

    .search-modal-input {
      flex: 1;
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: var(--bg-color);
      color: var(--text-color);
      font-size: 13px;
      font-family: inherit;
      outline: none;
    }

    .search-modal-input:focus {
      border-color: var(--primary-color);
    }

    .search-modal-close {
      padding: 6px 10px;
      font-size: 11px;
      font-family: 'SF Mono', 'Monaco', monospace;
      color: var(--text-muted);
      background: var(--surface-color);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      cursor: pointer;
    }

    .search-modal-close:hover {
      color: var(--text-color);
      background: var(--hover-bg);
    }

    .search-modal-results {
      overflow-y: auto;
      flex: 1;
      padding: 8px 8px 12px;
    }

    .search-modal-empty {
      padding: 24px 16px;
      color: var(--text-muted);
      text-align: center;
      font-size: 12px;
    }

    .search-modal-group {
      padding: 4px 0;
    }

    .search-modal-group-heading {
      padding: 8px 12px 4px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .search-modal-result {
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 100%;
      padding: 10px 12px;
      margin: 2px 0;
      text-align: left;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      color: var(--text-color);
      font-family: inherit;
    }

    .search-modal-result:focus,
    .search-modal-result.is-highlighted {
      background: var(--hover-bg);
      border-color: var(--border-color);
      outline: none;
    }

    .search-modal-result-title {
      font-size: 12px;
      font-weight: 600;
    }

    .search-modal-result-desc {
      font-size: 11px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

`
