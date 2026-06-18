/**
 * Embedded docs UI client script chunk.
 */

export const navigationClientScript = String.raw`    // Search functionality
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderSidebar();
        renderContent();
      });
    }

    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const root = document.documentElement;
        const current = root.getAttribute('data-theme') || 'auto';
        const next = current === 'auto' ? 'dark' : current === 'dark' ? 'light' : current === 'light' ? 'custom' : 'auto';
        root.setAttribute('data-theme', next);
        localStorage?.setItem?.('raffel-docs-theme', next);
      });
    }

    const backToTop = document.getElementById('backToTop');
    if (backToTop) {
      backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    window.addEventListener('scroll', () => {
      const progress = document.getElementById('readingProgress');
      if (progress) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const pct = max > 0 ? (window.scrollY / max) * 100 : 0;
        progress.style.width = pct + '%';
      }
      if (backToTop) {
        backToTop.classList.toggle('visible', window.scrollY > 400);
      }
    }, { passive: true });

    window.addEventListener('hashchange', () => {
      const route = parseRouteHash();
      activePagePath = route.pagePath;
      activeHeadingId = route.headingId;
      activePagePath = resolveDocsAlias(activePagePath);
      runVoidHook('onRouteChange', getPluginContext({ pagePath: activePagePath }));
      unmountDocsComponents(document.getElementById('mainContent'));
      renderSidebar();
      renderContent();
      highlightCodeBlocks(document.getElementById('mainContent'));
      enhanceCodeBlockToolbars(document.getElementById('mainContent'));
      renderMermaidDiagrams();
      mountDocsComponents(document.getElementById('mainContent'));
    });

    function renderProtocolTabs() {
      const container = document.getElementById('protocolTabs');
      if (!container) return;
      container.textContent = '';
      protocols.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'protocol-tab' + (!activePagePath && p === activeProtocol ? ' active' : '');
        const label = p.charAt(0).toUpperCase() + p.slice(1);
        const count = protocolData[p];
        btn.innerHTML = label + (sidebarConfig.showCounts !== false ? '<span class="count">' + count + '</span>' : '');
        btn.onclick = () => setProtocol(p);
        container.appendChild(btn);
      });
    }

    function setProtocol(protocol) {
      activeProtocol = protocol;
      activePagePath = '';
      activeHeadingId = '';
      if (location.hash && location.hash.startsWith('#/')) {
        history.replaceState(null, '', '#docs');
      }
      unmountDocsComponents(document.getElementById('mainContent'));
      renderProtocolTabs();
      renderSidebar();
      renderContent();
      highlightCodeBlocks(document.getElementById('mainContent'));
      enhanceCodeBlockToolbars(document.getElementById('mainContent'));
      renderMermaidDiagrams();
      mountDocsComponents(document.getElementById('mainContent'));
    }

    function setDocsPage(path, headingId) {
      activePagePath = resolveDocsAlias(normalizeDocsPath(path));
      activeHeadingId = headingId || '';
      history.replaceState(null, '', '#' + activePagePath + (activeHeadingId ? '?id=' + encodeURIComponent(activeHeadingId) : ''));
      runVoidHook('onRouteChange', getPluginContext({ pagePath: activePagePath, headingId: activeHeadingId }));
      unmountDocsComponents(document.getElementById('mainContent'));
      renderProtocolTabs();
      renderSidebar();
      renderContent();
      highlightCodeBlocks(document.getElementById('mainContent'));
      enhanceCodeBlockToolbars(document.getElementById('mainContent'));
      renderMermaidDiagrams();
      mountDocsComponents(document.getElementById('mainContent'));
      if (activeHeadingId) {
        const target = document.getElementById(activeHeadingId);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    function renderSidebar() {
      const nav = document.getElementById('sidebarNav');
      if (!nav) return;
      nav.textContent = '';

      renderDocsPagesNav(nav);

      // Add Introduction link if there's a description (and not searching)
      if (!searchQuery && spec.info && spec.info.description && !activePagePath) {
        const introLink = document.createElement('div');
        introLink.className = 'nav-item nav-item-intro';
        introLink.innerHTML = '<span class="nav-item-icon">Docs</span><span class="nav-item-text">Introduction</span>';
        introLink.onclick = () => {
          const el = document.getElementById('introduction');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        nav.appendChild(introLink);
      }

      if (activePagePath) return;

      // Get endpoints for current protocol
      const endpoints = getEndpointsForProtocol(activeProtocol);

      // Filter by search
      const filtered = searchQuery
        ? endpoints.filter(e =>
            e.path.toLowerCase().includes(searchQuery) ||
            (e.summary || '').toLowerCase().includes(searchQuery) ||
            (e.description || '').toLowerCase().includes(searchQuery)
          )
        : endpoints;

      // Group by tags
      const tagMap = new Map();
      const untagged = [];

      filtered.forEach(ep => {
        const tags = ep.tags || ['Other'];
        if (tags.length === 0) {
          untagged.push(ep);
        } else {
          tags.forEach(tag => {
            if (!tagMap.has(tag)) tagMap.set(tag, []);
            tagMap.get(tag).push(ep);
          });
        }
      });

      // Use tagGroups if defined, otherwise auto-group by tags (sorted, Other last)
      const sortedTags = Array.from(tagMap.keys()).sort((a, b) => {
        if (a === 'Other') return 1;
        if (b === 'Other') return -1;
        return a.localeCompare(b);
      });
      const groups = tagGroups.length > 0 ? tagGroups : sortedTags.map(name => ({
        name,
        tags: [name],
        expanded: sidebarConfig.expandAll !== false
      }));

      groups.forEach((group) => {
        const groupEndpoints = [];
        group.tags.forEach(tag => {
          const eps = tagMap.get(tag) || [];
          groupEndpoints.push(...eps);
        });

        if (groupEndpoints.length === 0) return;

        const groupEl = document.createElement('div');
        groupEl.className = 'tag-group' + (group.expanded === false ? ' collapsed' : '');

        const header = document.createElement('div');
        header.className = 'tag-group-header';
        header.innerHTML = '<span class="tag-group-arrow">▼</span>' +
          esc(group.name) +
          '<span class="tag-group-count">' + groupEndpoints.length + '</span>';
        header.onclick = () => groupEl.classList.toggle('collapsed');

        const items = document.createElement('div');
        items.className = 'tag-group-items';
        items.style.maxHeight = group.expanded === false ? '0' : (groupEndpoints.length * 50) + 'px';

        groupEndpoints.forEach(ep => {
          const item = document.createElement('div');
          item.className = 'nav-item';
          item.innerHTML = '<span class="nav-item-method ' + getMethodClass(ep.method) + '">' +
            esc(ep.method) + '</span><span class="nav-item-path">' + esc(ep.path) + '</span>';
          item.onclick = (e) => {
            e.stopPropagation();
            scrollToEndpoint(ep.id);
          };
          items.appendChild(item);
        });

        groupEl.appendChild(header);
        groupEl.appendChild(items);
        nav.appendChild(groupEl);
      });

      if (untagged.length > 0) {
        const groupEl = document.createElement('div');
        groupEl.className = 'tag-group';

        const header = document.createElement('div');
        header.className = 'tag-group-header';
        header.innerHTML = '<span class="tag-group-arrow">▼</span>Other<span class="tag-group-count">' + untagged.length + '</span>';
        header.onclick = () => groupEl.classList.toggle('collapsed');

        const items = document.createElement('div');
        items.className = 'tag-group-items';
        items.style.maxHeight = (untagged.length * 50) + 'px';

        untagged.forEach(ep => {
          const item = document.createElement('div');
          item.className = 'nav-item';
          item.innerHTML = '<span class="nav-item-method ' + getMethodClass(ep.method) + '">' +
            esc(ep.method) + '</span><span class="nav-item-path">' + esc(ep.path) + '</span>';
          item.onclick = (e) => {
            e.stopPropagation();
            scrollToEndpoint(ep.id);
          };
          items.appendChild(item);
        });

        groupEl.appendChild(header);
        groupEl.appendChild(items);
        nav.appendChild(groupEl);
      }
    }

    function renderDocsPagesNav(nav) {
      if (sidebarConfig.docsPages === false || !Array.isArray(docsPages) || docsPages.length === 0) return;
      if (Array.isArray(docsSidebar) && docsSidebar.length > 0 && !searchQuery) {
        renderDeclarativeDocsSidebar(nav);
        return;
      }
      const pages = getDocsPageViews();
      const filteredPages = searchQuery
        ? pages.filter(page =>
            (page.title || '').toLowerCase().includes(searchQuery) ||
            (page.description || '').toLowerCase().includes(searchQuery) ||
            (page.markdown || '').toLowerCase().includes(searchQuery)
          )
        : pages;
      if (filteredPages.length === 0) return;

      const sectionMap = new Map();
      filteredPages.forEach(page => {
        const section = page.section || 'Guides';
        if (!sectionMap.has(section)) sectionMap.set(section, []);
        sectionMap.get(section).push(page);
      });

      sectionMap.forEach((sectionPages, sectionName) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'tag-group docs-pages-group';
        const header = document.createElement('div');
        header.className = 'tag-group-header';
        header.innerHTML = '<span class="tag-group-arrow">▼</span>' +
          esc(sectionName) +
          '<span class="tag-group-count">' + sectionPages.length + '</span>';
        header.onclick = () => groupEl.classList.toggle('collapsed');

        const items = document.createElement('div');
        items.className = 'tag-group-items';
        const headingCount = sectionPages.reduce((count, page) => (
          count + (normalizeDocsPath(page.path) === activePagePath && !searchQuery ? extractSidebarHeadings(page.markdown).length : 0)
        ), 0);
        items.style.maxHeight = ((sectionPages.length * 50) + (headingCount * 34)) + 'px';
        sectionPages.forEach(page => {
          const path = normalizeDocsPath(page.path);
          const item = document.createElement('div');
          item.className = 'nav-item docs-page-nav-item' + (path === activePagePath ? ' active' : '');
          item.innerHTML = '<span class="nav-item-text">' + esc(page.title || page.path) + '</span>';
          item.onclick = (event) => {
            event.stopPropagation();
            setDocsPage(path);
          };
          items.appendChild(item);
          if (path === activePagePath && !searchQuery) {
            const headings = extractSidebarHeadings(page.markdown);
            if (headings.length > 0) {
              const subItems = document.createElement('div');
              subItems.className = 'nav-subitems';
              headings.forEach(heading => {
                const child = document.createElement('button');
                child.type = 'button';
                child.className = 'nav-subitem nav-subitem-level-' + heading.level;
                child.textContent = heading.title;
                child.onclick = (event) => {
                  event.stopPropagation();
                  if (path !== activePagePath) setDocsPage(path);
                  const target = document.getElementById(heading.id);
                  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  history.replaceState(null, '', '#' + path + '?id=' + encodeURIComponent(heading.id));
                };
                subItems.appendChild(child);
              });
              items.appendChild(subItems);
            }
          }
        });

        groupEl.appendChild(header);
        groupEl.appendChild(items);
        nav.appendChild(groupEl);
      });
    }

    function renderDeclarativeDocsSidebar(nav) {
      docsSidebar.forEach(item => appendDeclarativeSidebarItem(nav, item, 0));
    }

    function appendDeclarativeSidebarItem(parent, item, depth) {
      const children = Array.isArray(item.children) ? item.children : [];
      const title = String(item.title || item.path || item.href || '');
      if (!title) return;
      const itemPath = item.path ? resolveDocsAlias(normalizeDocsPath(item.path)) : '';
      const active = Boolean(itemPath && itemPath === activePagePath);
      const expanded = sidebarConfig.expandAll === true || active || children.some(sidebarItemContainsActivePath);

      if (children.length > 0) {
        const groupEl = document.createElement('div');
        groupEl.className = 'tag-group docs-sidebar-group docs-sidebar-depth-' + depth + (expanded ? '' : ' collapsed');
        const header = document.createElement('div');
        header.className = 'tag-group-header' + (active ? ' active' : '');
        header.innerHTML = '<span class="tag-group-arrow">▼</span>' + esc(title) +
          '<span class="tag-group-count">' + countSidebarLeaves(children) + '</span>';
        header.onclick = () => groupEl.classList.toggle('collapsed');
        const items = document.createElement('div');
        items.className = 'tag-group-items';
        items.style.maxHeight = expanded ? (Math.max(1, countSidebarRows(children)) * 90) + 'px' : '0';
        if (itemPath || item.href) {
          items.appendChild(createDeclarativeSidebarPage(item, title, active, depth));
          if (active && !searchQuery) appendActivePageHeadings(items, item.path || activePagePath);
        }
        children.forEach(child => appendDeclarativeSidebarItem(items, child, depth + 1));
        groupEl.appendChild(header);
        groupEl.appendChild(items);
        parent.appendChild(groupEl);
        return;
      }

      parent.appendChild(createDeclarativeSidebarPage(item, title, active, depth));
      if (active && !searchQuery) appendActivePageHeadings(parent, item.path || activePagePath);
    }

    function createDeclarativeSidebarPage(item, title, active, depth) {
      const el = document.createElement('div');
      el.className = 'nav-item docs-page-nav-item docs-sidebar-page docs-sidebar-depth-' + depth + (active ? ' active' : '');
      el.innerHTML = '<span class="nav-item-text">' + esc(title) + '</span>';
      el.onclick = (event) => {
        event.stopPropagation();
        if (item.href && !item.path) {
          if (/^(?:https?:)?\/\//i.test(item.href)) location.href = item.href;
          else history.replaceState(null, '', item.href);
          return;
        }
        if (item.path) setDocsPage(item.path);
      };
      return el;
    }

    function appendActivePageHeadings(parent, path) {
      const page = getDocsPageViews().find(candidate => candidate.path === resolveDocsAlias(normalizeDocsPath(path)));
      if (!page) return;
      const headings = extractSidebarHeadings(page.markdown);
      if (headings.length === 0) return;
      const subItems = document.createElement('div');
      subItems.className = 'nav-subitems';
      headings.forEach(heading => {
        const child = document.createElement('button');
        child.type = 'button';
        child.className = 'nav-subitem nav-subitem-level-' + heading.level + (heading.id === activeHeadingId ? ' active' : '');
        child.textContent = heading.title;
        child.onclick = (event) => {
          event.stopPropagation();
          setDocsPage(activePagePath || path, heading.id);
        };
        subItems.appendChild(child);
      });
      parent.appendChild(subItems);
    }

    function sidebarItemContainsActivePath(item) {
      const itemPath = item.path ? resolveDocsAlias(normalizeDocsPath(item.path)) : '';
      return Boolean(itemPath && itemPath === activePagePath) ||
        (Array.isArray(item.children) && item.children.some(sidebarItemContainsActivePath));
    }

    function countSidebarLeaves(items) {
      return items.reduce((count, item) => count + (Array.isArray(item.children) && item.children.length > 0 ? countSidebarLeaves(item.children) : 1), 0);
    }

    function countSidebarRows(items) {
      return items.reduce((count, item) => count + 1 + (Array.isArray(item.children) ? countSidebarRows(item.children) : 0), 0);
    }

    function getMethodClass(method) {
      const m = method.toLowerCase();
      if (m === 'get') return 'method-get';
      if (m === 'post') return 'method-post';
      if (m === 'put') return 'method-put';
      if (m === 'patch') return 'method-patch';
      if (m === 'delete') return 'method-delete';
      if (m === 'ws' || m === 'websocket') return 'method-ws';
      if (m === 'stream' || m === 'sse') return 'method-stream';
      if (m === 'rpc') return 'method-rpc';
      if (m === 'grpc' || m === 'unary') return 'method-grpc';
      return 'method-post';
    }

    function getEndpointsForProtocol(protocol) {
      const endpoints = [];
      let id = 0;

      if (protocol === 'http' && spec.paths) {
        Object.entries(spec.paths).forEach(([path, methods]) => {
          Object.entries(methods).forEach(([method, op]) => {
            if (!['get','post','put','patch','delete'].includes(method)) return;
            endpoints.push({
              id: 'ep-' + (id++),
              path,
              method: method.toUpperCase(),
              summary: op.summary,
              description: op.description,
              tags: op.tags || [],
              data: op
            });
          });
        });
      } else if (protocol === 'websocket' && wsSpec?.channels) {
        Object.entries(wsSpec.channels).forEach(([name, channel]) => {
          endpoints.push({
            id: 'ep-' + (id++),
            path: name,
            method: 'WS',
            summary: channel.description,
            tags: channel.tags || [],
            data: channel
          });
        });
      } else if (protocol === 'streams' && streamsSpec?.endpoints) {
        Object.entries(streamsSpec.endpoints).forEach(([name, endpoint]) => {
          endpoints.push({
            id: 'ep-' + (id++),
            path: name,
            method: endpoint.direction || 'STREAM',
            summary: endpoint.description,
            tags: endpoint.tags || [],
            data: endpoint
          });
        });
      } else if (protocol === 'jsonrpc' && jsonrpcSpec?.methods) {
        Object.entries(jsonrpcSpec.methods).forEach(([name, method]) => {
          endpoints.push({
            id: 'ep-' + (id++),
            path: name,
            method: 'RPC',
            summary: method.description,
            tags: method.tags || [],
            data: method
          });
        });
      } else if (protocol === 'grpc' && grpcSpec?.services) {
        Object.entries(grpcSpec.services).forEach(([serviceName, service]) => {
          Object.entries(service.methods || {}).forEach(([methodName, method]) => {
            const type = getGrpcMethodType(method);
            endpoints.push({
              id: 'ep-' + (id++),
              path: serviceName + '/' + methodName,
              method: type.toUpperCase(),
              summary: method.description,
              tags: service.tags || [],
              data: { service, method, serviceName, methodName }
            });
          });
        });
      } else if (protocol === 'tcp' && tcpSpec?.servers) {
        Object.entries(tcpSpec.servers).forEach(([name, server]) => {
          endpoints.push({
            id: 'ep-' + (id++),
            path: name,
            method: 'TCP',
            summary: server.description,
            tags: server.tags || [],
            data: server
          });
        });
      } else if (protocol === 'udp' && udpSpec?.endpoints) {
        Object.entries(udpSpec.endpoints).forEach(([name, endpoint]) => {
          endpoints.push({
            id: 'ep-' + (id++),
            path: name,
            method: 'UDP',
            summary: endpoint.description,
            tags: endpoint.tags || [],
            data: endpoint
          });
        });
      } else if (protocol === 'graphql' && (spec.components?.schemas?.Query || spec['x-usd']?.graphql?.types)) {
        const graphqlSpec = spec['x-usd']?.graphql;
        if (graphqlSpec?.types) {
          Object.entries(graphqlSpec.types).forEach(([name, type]) => {
            endpoints.push({
              id: 'ep-' + (id++),
              path: name,
              method: 'GQL',
              summary: type.description,
              tags: type.tags || [],
              data: type
            });
          });
        }
      }

      return endpoints;
    }

    function scrollToEndpoint(id) {
      activePagePath = '';
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('expanded');
        // Render "Try it Out" in right panel when endpoint is selected
        const endpoints = getEndpointsForProtocol(activeProtocol);
        const endpoint = endpoints.find(ep => ep.id === id);
        if (endpoint && renderTryItOut) {
          renderTryItOut(endpoint);
        }
      }
    }

`
