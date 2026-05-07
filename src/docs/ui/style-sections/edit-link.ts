/**
 * Page-header edit-on-source link styles.
 *
 * Uses existing shell tokens only (--text-secondary, --accent, --hover-bg).
 */
export const editLinkStyles = `    /* ========== PAGE HEADER WITH EDIT LINK ========== */
    .docs-page-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }

    .docs-page-header > h1,
    .docs-page-header > .md-h1 {
      flex: 1 1 auto;
      margin-bottom: 0;
    }

    .docs-edit-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-secondary);
      text-decoration: none;
      padding: 4px 8px;
      border-radius: 6px;
      transition: color 120ms ease, background-color 120ms ease;
    }

    .docs-edit-link:hover,
    .docs-edit-link:focus-visible {
      color: var(--accent);
      background-color: var(--hover-bg);
      text-decoration: none;
    }

    .docs-edit-link:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .docs-edit-link-glyph {
      font-size: 13px;
      line-height: 1;
    }
`
