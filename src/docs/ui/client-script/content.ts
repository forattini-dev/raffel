/**
 * Embedded docs UI client script chunk.
 */

export const contentClientScript = String.raw`    function renderContent() {
      const main = document.getElementById('mainContent');
      main.textContent = '';

      const docsPage = getActiveDocsPage();
      if (docsPage) {
        renderDocsPage(main, docsPage);
        renderTableOfContents(main);
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
    }

    function getActiveDocsPage() {
      if (!activePagePath || !Array.isArray(docsPages)) return null;
      return getDocsPageViews().find(page => normalizeDocsPath(page.path) === activePagePath) || null;
    }

    function renderDocsPage(main, page) {
      const article = document.createElement('article');
      article.className = 'docs-page markdown-content';
      article.dataset.path = page.path;
      article.innerHTML = parseMarkdown(page.markdown || '');
      main.appendChild(article);
      document.title = page.title ? page.title + ' - ' + spec.info.title : spec.info.title;
      renderDocsPagination(main, page);
    }

    function renderDocsPageSearchResults(main) {
      if (!Array.isArray(docsPages) || docsPages.length === 0) return;
      const matches = getDocsPageViews().filter(page =>
        (page.title || '').toLowerCase().includes(searchQuery) ||
        (page.description || '').toLowerCase().includes(searchQuery) ||
        (page.markdown || '').toLowerCase().includes(searchQuery)
      );
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

    function renderDocsPagination(main, page) {
      const pages = getDocsPageViews();
      const currentIndex = pages.findIndex(item => normalizeDocsPath(item.path) === normalizeDocsPath(page.path));
      if (currentIndex === -1 || pages.length < 2) return;

      const previous = pages[currentIndex - 1];
      const next = pages[currentIndex + 1];
      const nav = document.createElement('nav');
      nav.className = 'docs-pagination';
      nav.setAttribute('aria-label', 'Documentation pagination');

      if (previous) {
        nav.appendChild(createDocsPaginationLink(previous, 'Previous', 'previous'));
      } else {
        nav.appendChild(document.createElement('span'));
      }

      if (next) {
        nav.appendChild(createDocsPaginationLink(next, 'Next', 'next'));
      }

      main.appendChild(nav);
    }

    function createDocsPaginationLink(page, label, direction) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'docs-pagination-link docs-pagination-' + direction;
      link.innerHTML = '<span class="docs-pagination-label">' + esc(label) + '</span>' +
        '<span class="docs-pagination-title">' + esc(page.title) + '</span>';
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

      const min = Number(tocConfig.minLevel || 2);
      const max = Number(tocConfig.maxLevel || 3);
      const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'))
        .filter(heading => {
          const level = Number(heading.tagName.slice(1));
          return level >= min && level <= max && heading.id;
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
