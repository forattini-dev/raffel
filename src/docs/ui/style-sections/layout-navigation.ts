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
      background: var(--hover-bg);
      color: var(--text-color);
    }

    .nav-subitem.active {
      color: var(--primary-color);
      font-weight: 600;
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

`
