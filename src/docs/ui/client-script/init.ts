/**
 * Embedded docs UI client script chunk.
 */

export const initClientScript = String.raw`    // Render introduction markdown if provided
    // Note: introductionMarkdown is server-generated trusted content from USD spec
    // parseMarkdown() escapes text before processing markdown syntax
    function renderIntroduction() {
      const container = document.getElementById('introductionContent');
      if (!container || !introductionMarkdown) return;
      container.innerHTML = parseMarkdown(introductionMarkdown);
    }

    function renderMermaidDiagrams(root = document) {
      const diagrams = Array.from(root.querySelectorAll('.mermaid:not([data-mermaid-rendered])'));
      if (diagrams.length === 0) return;
      if (!window.mermaid) {
        diagrams.forEach(diagram => diagram.classList.add('mermaid-fallback'));
        return;
      }
      window.mermaid.initialize?.({ startOnLoad: false, securityLevel: 'strict' });
      diagrams.forEach((diagram, index) => {
        const source = diagram.getAttribute('data-mermaid-source') || diagram.textContent || '';
        const id = 'raffel-mermaid-' + Date.now() + '-' + index;
        Promise.resolve(window.mermaid.render(id, source))
          .then(result => {
            diagram.innerHTML = typeof result === 'string' ? result : result.svg;
            result?.bindFunctions?.(diagram);
            diagram.dataset.mermaidRendered = 'true';
            diagram.classList.remove('mermaid-fallback', 'mermaid-error');
          })
          .catch(error => {
            diagram.dataset.mermaidRendered = 'error';
            diagram.classList.add('mermaid-error');
            diagram.setAttribute('title', error instanceof Error ? error.message : 'Unable to render Mermaid diagram');
          });
      });
    }

    function parseComponentProps(raw) {
      const source = String(raw || '').trim();
      if (!source) return {};
      try {
        const parsed = JSON.parse(source);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }

    function mountDocsComponents(root = document) {
      const targets = Array.from(root.querySelectorAll('[data-raffel-component]:not([data-raffel-component-mounted])'));
      targets.forEach(target => {
        const name = String(target.getAttribute('data-raffel-component') || '').trim();
        if (!name) return;
        const props = parseComponentProps(target.getAttribute('data-props'));
        target.dataset.raffelComponentMounted = 'true';
        target.dataset.pagePath = activePagePath;
        const context = getPluginContext({ pagePath: activePagePath });
        docsPlugins.forEach(plugin => plugin.mountComponent?.(target, name, props, context));
      });
    }

    function highlightCodeBlocks(root = document) {
      if (!window.Prism?.highlightElement) return;
      const blocks = Array.from(root.querySelectorAll('pre code[class*="language-"]:not([data-prism-highlighted])'));
      blocks.forEach(block => {
        window.Prism.highlightElement(block);
        block.dataset.prismHighlighted = 'true';
      });
      document.documentElement.setAttribute('data-syntax-highlight', 'prism');
    }

    function enhanceCodeBlockToolbars(root) {
      const scope = root || document;
      if (!scope.querySelectorAll) return;
      const codes = scope.querySelectorAll('pre > code[class*="language-"]');
      codes.forEach(code => {
        const pre = code.parentElement;
        if (!pre || pre.getAttribute('data-code-toolbar-enhanced') === 'true') return;
        pre.setAttribute('data-code-toolbar-enhanced', 'true');
        if (pre.style && !pre.style.position) pre.style.position = 'relative';
        const langMatch = String(code.className || '').match(/(?:^|\s)language-([\w+#.-]+)/);
        const lang = langMatch ? langMatch[1].toLowerCase() : '';
        const toolbar = document.createElement('div');
        toolbar.className = 'code-block-toolbar';
        const langEl = document.createElement('span');
        langEl.className = 'code-block-lang';
        langEl.textContent = lang;
        if (!lang) langEl.setAttribute('hidden', 'hidden');
        toolbar.appendChild(langEl);
        const button = document.createElement('button');
        button.setAttribute('type', 'button');
        button.className = 'code-block-copy';
        button.textContent = 'Copy';
        button.addEventListener('click', () => {
          const text = String(code.textContent || '');
          const finish = () => {
            button.textContent = 'Copied';
            setTimeout(() => { if (button.textContent === 'Copied') button.textContent = 'Copy'; }, 1000);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
              const result = navigator.clipboard.writeText(text);
              if (result && typeof result.then === 'function') result.then(finish).catch(finish);
              else finish();
            } catch { finish(); }
          } else finish();
        });
        toolbar.appendChild(button);
        pre.insertBefore(toolbar, pre.firstChild);
        const wrap = pre.parentElement;
        if (wrap && wrap.classList && wrap.classList.contains('md-code-wrap')) {
          const legacy = wrap.querySelector(':scope > .copy-code-btn');
          if (legacy) legacy.setAttribute('hidden', 'hidden');
        }
      });
    }

    document.addEventListener('click', (event) => {
      const zoomClose = event.target.closest('.image-zoom-close');
      if (zoomClose || event.target.classList?.contains('image-zoom-overlay')) {
        document.querySelector('.image-zoom-overlay')?.remove();
        return;
      }

      const zoomImage = event.target.closest('.markdown-content .md-image');
      if (zoomImage?.src) {
        if (zoomImage.matches('[data-no-zoom="true"], .no-zoom')) return;
        document.querySelector('.image-zoom-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'image-zoom-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = '<button type="button" class="image-zoom-close" aria-label="Close image preview">&times;</button>' +
          '<img class="image-zoom-img" src="' + escapeAttr(zoomImage.src) + '" alt="' + escapeAttr(zoomImage.alt || '') + '">';
        document.body.appendChild(overlay);
        docsPlugins.forEach(plugin => plugin.onImageZoom?.(String(zoomImage.src), String(zoomImage.alt || ''), getPluginContext({ pagePath: activePagePath })));
        return;
      }

      const tabButton = event.target.closest('.md-tab-button');
      if (tabButton) {
        const tabs = tabButton.closest('.md-tabs');
        const tabIndex = tabButton.getAttribute('data-tab-index');
        tabs?.querySelectorAll('.md-tab-button').forEach(button => button.classList.toggle('active', button === tabButton));
        tabs?.querySelectorAll('.md-tab-panel').forEach(panel => panel.classList.toggle('active', panel.getAttribute('data-tab-index') === tabIndex));
        docsPlugins.forEach(plugin => plugin.onTabChange?.(tabButton.textContent?.trim?.() || '', Number(tabIndex || 0), getPluginContext({ pagePath: activePagePath })));
        return;
      }

      const copyButton = event.target.closest('.copy-code-btn');
      if (!copyButton) return;
      const wrap = copyButton.closest('.md-code-wrap');
      const code = wrap ? wrap.querySelector('code') : null;
      if (!code) return;
      const text = code.textContent || '';
      const markCopied = () => {
        const previous = copyButton.textContent;
        copyButton.textContent = 'Copied';
        setTimeout(() => {
          copyButton.textContent = previous || 'Copy';
        }, 1500);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(markCopied).catch(() => {});
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        markCopied();
      }
      docsPlugins.forEach(plugin => plugin.onCopyCode?.(text, getPluginContext({ pagePath: activePagePath })));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        document.querySelector('.image-zoom-overlay')?.remove();
      }
    });

    document.addEventListener('keydown', (event) => {
      const wantsSearch = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey;
      const wantsCommandSearch = event.key?.toLowerCase?.() === 'k' && (event.ctrlKey || event.metaKey);
      if (wantsSearch || wantsCommandSearch) {
        const search = document.getElementById('searchInput');
        if (search && document.activeElement !== search) {
          event.preventDefault();
          search.focus();
          document.documentElement.setAttribute('data-search-focused', 'true');
        }
      }
    });

    const storedTheme = localStorage?.getItem?.('raffel-docs-theme');
    if (storedTheme === 'auto' || storedTheme === 'dark' || storedTheme === 'light' || storedTheme === 'custom') {
      document.documentElement.setAttribute('data-theme', storedTheme);
    }

    // Initial render
    installDocsPluginApi();
    renderIntroduction();
    renderFooter();
    renderProtocolTabs();
    renderSidebar();
    renderContent();
    highlightCodeBlocks(document.getElementById('mainContent'));
    enhanceCodeBlockToolbars(document.getElementById('mainContent'));
    renderMermaidDiagrams();
    mountDocsComponents(document.getElementById('mainContent'));
`
