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
      display: grid;
      grid-template-columns: 300px 1fr;
      min-height: calc(100vh - 300px);
    }

    .app-container-no-sidebar {
      grid-template-columns: 1fr;
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

    .sidebar-hidden {
      display: none;
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
      font-size: 14px;
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
      padding: 6px 12px 6px 14px;
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
      font-size: 12px;
      line-height: 1.35;
      padding: 5px 8px;
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
      padding: 1px 4px;
      border: 1px solid var(--border-color);
      border-radius: 2px;
      text-transform: uppercase;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--text-secondary);
      background: transparent;
      letter-spacing: 0.02em;
    }

    /* Method classes kept for HTML compatibility but visually unified.
       The DELETE verb gets the only chromatic accent — destructive
       intent earns visual weight. */
    .method-get,
    .method-post,
    .method-put,
    .method-patch,
    .method-ws,
    .method-stream,
    .method-rpc,
    .method-grpc {
      color: var(--text-secondary);
      background: transparent;
      border-color: var(--border-color);
    }

    .method-delete {
      color: var(--primary-color);
      border-color: var(--primary-color);
      background: transparent;
    }

    .nav-item-path {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ========== TOC (On this page) — editorial sidenote ========== */
    .toc {
      align-self: start;
      position: sticky;
      top: 24px;
      padding: 8px 0 8px 16px;
      border-left: 1px solid var(--border-color);
      font-size: var(--font-size-small);
      line-height: 1.5;
      max-height: calc(100vh - 48px);
      overflow-y: auto;
    }

    .toc:empty {
      border: 0;
      padding: 0;
    }

    .toc-title {
      color: var(--text-muted);
      font-size: var(--font-size-xs);
      font-weight: 600;
      letter-spacing: 0.04em;
      margin: 0 0 8px;
      text-transform: uppercase;
    }

    .toc-link {
      display: block;
      padding: 3px 0;
      color: var(--text-secondary);
      text-decoration: none;
      border-left: 2px solid transparent;
      margin-left: -16px;
      padding-left: 14px;
      transition: color 0.15s, border-color 0.15s;
    }

    .toc-link:hover {
      color: var(--text-primary);
    }

    .toc-link.active {
      color: var(--text-primary);
      border-left-color: var(--primary-color);
      font-weight: 600;
    }

    .toc-level-2 { padding-left: 14px; }
    .toc-level-3 { padding-left: 26px; }
    .toc-level-4 { padding-left: 38px; }
    .toc-level-5 { padding-left: 50px; }
    .toc-level-6 { padding-left: 62px; }

`
