/**
 * Embedded docs UI client script chunk.
 */

export const contentClientScript = String.raw`    function renderContent() {
      const main = document.getElementById('mainContent');
      unmountDocsComponents(main);
      main.textContent = '';
      runVoidHook('beforeRender', getPluginContext());

      const docsPage = getActiveDocsPage();
      if (docsPage) {
        renderDocsPage(main, docsPage);
        renderTableOfContents(main);
        renderMermaidDiagrams(main);
        mountDocsComponents(main);
        runVoidHook('afterRender', getPluginContext());
        return;
      }

      document.title = spec.info.title;

      if (searchQuery) {
        renderDocsPageSearchResults(main);
      }

      // Render API introduction/description (only when not searching)
      if (!searchQuery && spec.info && spec.info.description) {
        const intro = document.createElement('div');
        intro.className = 'intro-section';
        intro.id = 'introduction';

        const content = document.createElement('div');
        content.className = 'markdown-content';
        content.innerHTML = parseMarkdown(spec.info.description);
        intro.appendChild(content);
        main.appendChild(intro);
      }

      const endpoints = getEndpointsForProtocol(activeProtocol);
      const filtered = searchQuery
        ? endpoints.filter(e =>
            e.path.toLowerCase().includes(searchQuery) ||
            (e.summary || '').toLowerCase().includes(searchQuery) ||
            (e.description || '').toLowerCase().includes(searchQuery)
          )
        : endpoints;

      if (filtered.length === 0) {
        if (main.childElementCount === 0) {
          const empty = document.createElement('div');
          empty.className = 'section';
          empty.innerHTML = '<p style="color: var(--text-muted);">No endpoints found' +
            (searchQuery ? ' matching "' + esc(searchQuery) + '"' : '') + '</p>';
          main.appendChild(empty);
        }
        renderTableOfContents(main);
        renderMermaidDiagrams(main);
        mountDocsComponents(main);
        runVoidHook('afterRender', getPluginContext());
        return;
      }

      // Group by tags for display
      const tagMap = new Map();
      filtered.forEach(ep => {
        const tag = (ep.tags && ep.tags[0]) || 'Endpoints';
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag).push(ep);
      });

      tagMap.forEach((eps, tag) => {
        const section = document.createElement('div');
        section.className = 'section';

        const title = document.createElement('h2');
        title.className = 'section-title';
        title.id = slugifyHeading(tag);
        title.textContent = tag;
        section.appendChild(title);

        // Find tag description from spec
        const tagDef = (spec.tags || []).find(t => t.name === tag);
        if (tagDef?.description) {
          const desc = document.createElement('p');
          desc.className = 'section-desc';
          desc.textContent = tagDef.description;
          section.appendChild(desc);
        }

        eps.forEach(ep => {
          const card = createEndpointCard(ep);
          section.appendChild(card);
        });

        main.appendChild(section);
      });

      renderTableOfContents(main);
      renderMermaidDiagrams(main);
      mountDocsComponents(main);
      runVoidHook('afterRender', getPluginContext());
    }

    function getActiveDocsPage() {
      if (!activePagePath || !Array.isArray(docsPages)) return null;
      return getDocsPageViews().find(page => normalizeDocsPath(page.path) === activePagePath) || null;
    }

    function renderDocsPage(main, page) {
      const breadcrumb = renderDocsBreadcrumb(page);
      if (breadcrumb) main.appendChild(breadcrumb);
      const article = document.createElement('article');
      article.className = 'docs-page markdown-content';
      article.dataset.path = page.path;
      article.innerHTML = parseMarkdown(getDocsPageMarkdown(page));
      main.appendChild(article);
      document.title = page.title ? page.title + ' - ' + spec.info.title : spec.info.title;
      renderDocsPagination(main, page);
    }

    /* Resolve the breadcrumb chain from the declarative sidebar tree. Pure
       traversal — mirrors src/docs/ui/breadcrumbs.ts. Returns [] when the
       chain has fewer than 2 entries (single-segment / home / not found). */
    function resolveDocsBreadcrumbs(sidebar, activePath) {
      const items = Array.isArray(sidebar) ? sidebar : [];
      const target = normalizeDocsPath(activePath);
      if (!target) return [];
      const chain = findBreadcrumbChain(items, target);
      return chain && chain.length >= 2 ? chain : [];
    }

    function findBreadcrumbChain(items, target) {
      for (const item of items) {
        const itemPath = item && item.path ? normalizeDocsPath(item.path) : '';
        const isExternalOnly = !item.path && !!item.href;
        const ownEntry = isExternalOnly ? null : { title: String(item.title || item.path || item.href || '').trim(), path: itemPath };
        if (itemPath && itemPath === target && ownEntry) return [ownEntry];
        const children = Array.isArray(item.children) ? item.children : [];
        if (children.length > 0) {
          const sub = findBreadcrumbChain(children, target);
          if (sub) {
            const head = ownEntry || { title: String(item.title || item.path || item.href || '').trim(), path: '' };
            return [head, ...sub];
          }
        }
      }
      return null;
    }

    function renderDocsBreadcrumb(page) {
      const config = (typeof breadcrumbsConfig === 'object' && breadcrumbsConfig) || { enabled: true, hideOnHome: true };
      if (config.enabled === false) return null;
      const activePath = normalizeDocsPath(page && page.path);
      if (!activePath) return null;
      if (config.hideOnHome !== false && (activePath === '/' || activePath === '/index' || activePath === '/home')) return null;
      const chain = resolveDocsBreadcrumbs(docsSidebar, activePath);
      if (!chain || chain.length < 2) return null;
      const nav = document.createElement('nav');
      nav.className = 'docs-breadcrumb';
      nav.setAttribute('aria-label', 'Breadcrumb');
      const ol = document.createElement('ol');
      ol.className = 'docs-breadcrumb-list';
      chain.forEach((entry, idx) => {
        const li = document.createElement('li');
        li.className = 'docs-breadcrumb-item';
        const isLast = idx === chain.length - 1;
        if (isLast) {
          const span = document.createElement('span');
          span.className = 'docs-breadcrumb-current';
          span.setAttribute('aria-current', 'page');
          span.textContent = entry.title;
          li.appendChild(span);
        } else if (entry.path) {
          const a = document.createElement('a');
          a.className = 'docs-breadcrumb-link';
          a.href = '#' + entry.path;
          a.textContent = entry.title;
          a.onclick = (event) => {
            event.preventDefault();
            setDocsPage(entry.path);
          };
          li.appendChild(a);
        } else {
          const span = document.createElement('span');
          span.className = 'docs-breadcrumb-label';
          span.textContent = entry.title;
          li.appendChild(span);
        }
        ol.appendChild(li);
        if (!isLast) {
          const sep = document.createElement('span');
          sep.className = 'docs-breadcrumb-separator';
          sep.setAttribute('aria-hidden', 'true');
          sep.textContent = '›';
          ol.appendChild(sep);
        }
      });
      nav.appendChild(ol);
      return nav;
    }

    function renderDocsPageSearchResults(main) {
      if (!Array.isArray(docsPages) || docsPages.length === 0) return;
      const matches = applySearchResultsHook(getDocsPageViews().filter(page =>
        (page.title || '').toLowerCase().includes(searchQuery) ||
        (page.description || '').toLowerCase().includes(searchQuery) ||
        (page.markdown || '').toLowerCase().includes(searchQuery)
      ), getPluginContext());
      if (matches.length === 0) return;

      const section = document.createElement('section');
      section.className = 'section docs-search-results';
      const title = document.createElement('h2');
      title.className = 'section-title';
      title.id = 'docs-pages';
      title.textContent = 'Documentation pages';
      section.appendChild(title);

      matches
        .forEach(page => {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'docs-page-result';
          card.innerHTML = '<span class="docs-page-result-title">' + esc(page.title || page.path) + '</span>' +
            (page.description ? '<span class="docs-page-result-desc">' + esc(page.description) + '</span>' : '');
          card.onclick = () => setDocsPage(page.path);
          section.appendChild(card);
        });

      main.appendChild(section);
    }

    function flattenSidebarReadingOrder(items) {
      const out = [];
      const visit = node => {
        if (!node) return;
        const path = node.path;
        const isExternal = typeof path === 'string' && (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path) || /^(?:mailto|tel):/i.test(path));
        if (path && !isExternal) {
          const title = String(node.title || path).trim();
          out.push({ title, path });
        }
        if (Array.isArray(node.children)) node.children.forEach(visit);
      };
      (Array.isArray(items) ? items : []).forEach(visit);
      return out;
    }

    function getPageNavOptedOut() {
      const opted = new Set();
      const hide = (pageNavConfig && Array.isArray(pageNavConfig.hide)) ? pageNavConfig.hide : [];
      hide.forEach(path => { if (path) opted.add(normalizeDocsPath(String(path))); });
      (Array.isArray(docsPages) ? docsPages : []).forEach(raw => {
        if (!raw || !raw.path) return;
        const parsed = parsePageFrontmatter(raw.markdown || '');
        const flag = String(parsed.data.pageNav || '').toLowerCase();
        if (flag === 'false' || flag === 'no' || flag === '0') opted.add(normalizeDocsPath(raw.path));
      });
      return opted;
    }

    function renderDocsPagination(main, page) {
      if (pageNavConfig && pageNavConfig.enabled === false) return;
      const sidebar = Array.isArray(docsSidebar) ? docsSidebar : [];
      const order = flattenSidebarReadingOrder(sidebar).map(entry => ({
        title: entry.title,
        path: normalizeDocsPath(entry.path),
      }));
      if (order.length < 2) return;
      const optedOut = getPageNavOptedOut();
      const activePath = normalizeDocsPath(page.path);
      if (optedOut.has(activePath)) return;
      const index = order.findIndex(item => item.path === activePath);
      if (index === -1) return;
      let previous, next;
      for (let i = index - 1; i >= 0; i -= 1) {
        if (!optedOut.has(order[i].path)) { previous = order[i]; break; }
      }
      for (let i = index + 1; i < order.length; i += 1) {
        if (!optedOut.has(order[i].path)) { next = order[i]; break; }
      }
      if (!previous && !next) return;

      const nav = document.createElement('nav');
      nav.className = 'page-nav-grid docs-pagination';
      nav.setAttribute('aria-label', 'Page navigation');

      if (previous) nav.appendChild(createDocsPaginationLink(previous, 'Previous', 'prev'));
      else nav.appendChild(document.createElement('span'));

      if (next) nav.appendChild(createDocsPaginationLink(next, 'Next', 'next'));
      else nav.appendChild(document.createElement('span'));

      main.appendChild(nav);
    }

    function createDocsPaginationLink(page, label, direction) {
      const link = document.createElement('button');
      link.type = 'button';
      const legacyDir = direction === 'prev' ? 'previous' : 'next';
      link.className = 'page-nav-card page-nav-card-' + direction + ' docs-pagination-link docs-pagination-' + legacyDir;
      link.innerHTML = '<span class="page-nav-eyebrow docs-pagination-label">' + esc(label) + '</span>' +
        '<span class="page-nav-title docs-pagination-title">' + esc(page.title) + '</span>';
      link.onclick = () => setDocsPage(page.path);
      return link;
    }

    function renderFooter() {
      const footer = document.getElementById('docsFooter');
      if (!footer || !footerMarkdown) return;
      footer.innerHTML = parseMarkdown(footerMarkdown);
    }

    function renderTableOfContents(root) {
      const toc = document.getElementById('pageToc');
      if (!toc) return;
      toc.textContent = '';
      if (tocConfig.enabled === false) return;
      if (root.querySelector('[data-markdown-ignore-all="true"]')) return;

      const min = Number(tocConfig.minLevel || 2);
      const max = Number(tocConfig.maxLevel || 3);
      const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'))
        .filter(heading => {
          const level = Number(heading.tagName.slice(1));
          return level >= min && level <= max && heading.id && heading.dataset.markdownIgnore !== 'true';
        });

      if (headings.length === 0) return;

      const title = document.createElement('div');
      title.className = 'toc-title';
      title.textContent = 'On this page';
      toc.appendChild(title);

      headings.forEach(heading => {
        const level = Number(heading.tagName.slice(1));
        const item = document.createElement('a');
        item.className = 'toc-link toc-level-' + level;
        item.href = '#' + heading.id;
        item.textContent = heading.textContent ? heading.textContent.replace(/^#/, '').trim() : '';
        item.onclick = (event) => {
          event.preventDefault();
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
          history.replaceState(null, '', '#' + heading.id);
        };
        toc.appendChild(item);
      });
    }

`
