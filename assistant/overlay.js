/**
 * Novel Reading Assistant - Character Overlay
 * Loaded by index.waku.js when reading locally.
 * Reads assistant/data/{folder}.json and highlights character names in the page.
 */
(async function () {
  if (window.__charOverlayLoaded) return;
  window.__charOverlayLoaded = true;

  // --- 1. Detect which novel folder we're in ---
  const pathname = window.location.pathname.replace(/\\/g, '/');
  const folderMatch = pathname.match(/\/([^/]+)\/[^/]+\.html$/i);
  if (!folderMatch) return;
  const folder = folderMatch[1];

  // Ignore the assistant folder itself
  if (folder === 'assistant') return;

  // --- 2. Load character data ---
  let data = null;
  const tryPaths = [
    `/assistant/data/${folder}.json`,
    `../assistant/data/${folder}.json`,
    `./assistant/data/${folder}.json`,
  ];
  for (const p of tryPaths) {
    try {
      const r = await fetch(p, { cache: 'no-store' });
      if (r.ok) { data = await r.json(); break; }
    } catch (_) {}
  }
  if (!data || !data.characters || data.characters.length === 0) return;

  const characters = data.characters.filter(c => c.name && c.name.length >= 2);
  if (characters.length === 0) return;

  // --- 3. Inject styles ---
  const style = document.createElement('style');
  style.id = 'char-overlay-style';
  style.textContent = `
    .co-hl {
      background: rgba(200,169,110,0.25);
      border-bottom: 1px solid rgba(200,169,110,0.7);
      cursor: pointer;
      border-radius: 2px;
      transition: background 0.15s;
    }
    .co-hl:hover { background: rgba(200,169,110,0.5); }
    #co-popup {
      position: fixed;
      display: none;
      z-index: 99999;
      background: #1a1a1a;
      border: 1px solid #3a3a3a;
      border-radius: 10px;
      padding: 18px 20px;
      max-width: 320px;
      min-width: 240px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.85);
      color: #e0e0e0;
      font-family: 'Segoe UI', sans-serif;
      font-size: 14px;
      line-height: 1.6;
    }
    #co-popup h4 { color: #c8a96e; margin: 0 0 8px; font-size: 16px; font-weight: 700; }
    #co-popup .co-desc { color: #bbb; margin-bottom: 12px; white-space: pre-wrap; }
    #co-popup .co-appearances { border-top: 1px solid #333; padding-top: 10px; }
    #co-popup .co-app-item {
      display: flex; align-items: flex-start; margin-bottom: 8px;
      background: #252525; border-radius: 6px; padding: 6px 10px;
    }
    #co-popup .co-app-item .co-ch { color: #c8a96e; font-weight: 600; min-width: 60px; font-size: 13px; }
    #co-popup .co-app-item .co-ev { color: #aaa; font-size: 12px; flex: 1; }
    #co-popup .co-app-item a { color: #c8a96e; text-decoration: none; }
    #co-popup .co-app-item a:hover { text-decoration: underline; }
    #co-popup .co-close {
      position: absolute; top: 10px; right: 14px;
      background: none; border: none; color: #666;
      font-size: 18px; cursor: pointer; line-height: 1; padding: 0;
    }
    #co-popup .co-close:hover { color: #ccc; }
    #co-toggle {
      position: fixed; bottom: 70px; right: 16px;
      width: 36px; height: 36px;
      background: #1a1a1a; border: 1px solid #3a3a3a;
      border-radius: 50%; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; color: #c8a96e;
      box-shadow: 0 4px 12px rgba(0,0,0,0.6);
      z-index: 9998; transition: 0.2s; title: '人物高亮開關';
    }
    #co-toggle:hover { background: #252525; border-color: #c8a96e; }
    #co-toggle.off { color: #555; border-color: #2a2a2a; }
    
    /* Plot Sidebar */
    #co-sidebar {
      position: fixed; top: 0; right: -360px; width: 340px; height: 100vh;
      background: rgba(20, 20, 20, 0.95); backdrop-filter: blur(15px);
      border-left: 1px solid #333; z-index: 99990; transition: right 0.3s ease;
      padding: 30px 20px; overflow-y: auto; color: #eee;
      box-shadow: -10px 0 30px rgba(0,0,0,0.5);
    }
    #co-sidebar.open { right: 0; }
    #co-sidebar h2 { color: #c8a96e; font-size: 20px; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
    #co-sidebar h3 { color: #c8a96e; font-size: 16px; margin: 20px 0 10px; }
    .co-story-card { background: #1a1a1a; padding: 15px; border-radius: 8px; border: 1px solid #333; line-height: 1.8; margin-bottom: 20px; }
    .co-timeline-item { position: relative; padding: 0 0 20px 20px; border-left: 2px solid #c8a96e; margin-left: 10px; }
    .co-timeline-item::before { content: ''; position: absolute; left: -7px; top: 0; width: 12px; height: 12px; background: #c8a96e; border-radius: 50%; }
    .co-tl-name { font-weight: 700; color: #fff; display: block; margin-bottom: 4px; }
    .co-tl-desc { font-size: 13px; color: #aaa; }
    
    #co-plot-btn {
      position: fixed; bottom: 120px; right: 16px; width: 36px; height: 36px;
      background: #1a1a1a; border: 1px solid #3a3a3a; border-radius: 50%; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; color: #c8a96e; box-shadow: 0 4px 12px rgba(0,0,0,0.6);
      z-index: 9998; transition: 0.2s; title: '故事大綱/時間軸';
    }
    #co-plot-btn:hover { background: #252525; border-color: #c8a96e; }

  `;
  document.head.appendChild(style);

  // --- 4. Build popup element ---
  const popup = document.createElement('div');
  popup.id = 'co-popup';
  popup.innerHTML = `<button class="co-close" id="co-close-btn">&#10005;</button><div id="co-inner"></div>`;
  document.body.appendChild(popup);

  // --- 5. Toggle button ---
  let hlEnabled = true;
  const toggleBtn = document.createElement('div');
  toggleBtn.id = 'co-toggle';
  toggleBtn.title = '人物高亮開關';
  toggleBtn.textContent = '人';
  document.body.appendChild(toggleBtn);

  // --- Plot Sidebar ---
  const plotSidebar = document.createElement('div');
  plotSidebar.id = 'co-sidebar';
  document.body.appendChild(plotSidebar);

  const plotBtn = document.createElement('div');
  plotBtn.id = 'co-plot-btn';
  plotBtn.title = '故事大綱與時間軸';
  plotBtn.textContent = '📚';
  document.body.appendChild(plotBtn);

  plotBtn.addEventListener('click', () => {
    plotSidebar.classList.toggle('open');
  });

  // Render plot data
  let plotHTML = `<h2>${data.novel || folder} 劇情分析</h2>`;
  if (data.summary) {
    plotHTML += `<h3>故事大綱</h3><div class="co-story-card">${data.summary}</div>`;
  }
  if (data.timeline && data.timeline.length > 0) {
    plotHTML += `<h3>故事時間軸</h3><div class="co-timeline">`;
    data.timeline.forEach(item => {
      plotHTML += `
        <div class="co-timeline-item">
          <span class="co-tl-name">${item['事件名稱'] || item.name}</span>
          <div class="co-tl-desc">${item['前後關係'] || item.description || ''}</div>
          <div style="font-size:11px;color:#666;margin-top:4px;">登場角：${(item['關聯角色'] || []).join('、')}</div>
        </div>`;
    });
    plotHTML += `</div>`;
  }
  if (!data.summary && (!data.timeline || data.timeline.length === 0)) {
    plotHTML += `<p style="color:#666;text-align:center;margin-top:40px;">（無 AI 劇情資料）</p>`;
  }
  plotSidebar.innerHTML = plotHTML;


  toggleBtn.addEventListener('click', () => {
    hlEnabled = !hlEnabled;
    toggleBtn.classList.toggle('off', !hlEnabled);
    document.querySelectorAll('.co-hl').forEach(el => {
      el.style.background = hlEnabled ? '' : 'none';
      el.style.borderBottom = hlEnabled ? '' : 'none';
      el.style.cursor = hlEnabled ? 'pointer' : 'default';
    });
    popup.style.display = 'none';
  });

  // --- 6. Highlight text nodes ---
  // Build sorted array by name length desc (match longer names first)
  const sorted = [...characters].sort((a, b) => b.name.length - a.name.length);

  function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  const pattern = new RegExp(sorted.map(c => escapeReg(c.name)).join('|'), 'g');

  function highlightNode(textNode) {
    const text = textNode.nodeValue;
    if (!pattern.test(text)) return;
    pattern.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const ch = characters.find(c => c.name === m[0]);
      const span = document.createElement('span');
      span.className = 'co-hl';
      span.dataset.charId = ch ? ch.id : '';
      span.textContent = m[0];
      frag.appendChild(span);
      last = pattern.lastIndex;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode.replaceChild(frag, textNode);
  }

  // Walk text nodes in the reading content area only
  const contentRoot = document.querySelector('.novel-content, #content, article, body') || document.body;
  const walker = document.createTreeWalker(
    contentRoot, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentElement?.tagName;
        if (['SCRIPT','STYLE','NOSCRIPT','BUTTON','INPUT','A'].includes(tag)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.classList.contains('co-hl')) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('#co-popup, #co-toggle, nav, .navbar')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(highlightNode);

  // --- 7. Popup logic ---
  function showPopup(charId, anchorEl) {
    if (!hlEnabled) return;
    const ch = characters.find(c => String(c.id) === String(charId));
    if (!ch) return;

    const apps = ch.appearances || [];
    const inner = document.getElementById('co-inner');
    
    let tagsHTML = '';
    if (ch.gender) tagsHTML += `<span style="background:#2a2a2a;padding:2px 6px;border-radius:3px;margin-right:5px;font-size:11px;color:#aaa;">${ch.gender}</span>`;
    if (ch.faction) tagsHTML += `<span style="background:#2a2a2a;padding:2px 6px;border-radius:3px;margin-right:5px;font-size:11px;color:#aaa;">${ch.faction}</span>`;
    if (ch.power) tagsHTML += `<span style="background:#2a2a2a;padding:2px 6px;border-radius:3px;margin-right:5px;font-size:11px;color:#aaa;">${ch.power}</span>`;
    if (ch.status) {
      let color = ch.status==='存活'?'#2e7d32':(ch.status==='死亡'?'#c0392b':'#888');
      tagsHTML += `<span style="background:#2a2a2a;padding:2px 6px;border-radius:3px;margin-right:5px;font-size:11px;color:${color};font-weight:bold;">${ch.status}</span>`;
    }

    inner.innerHTML = `
      <h4>${ch.name}</h4>
      ${tagsHTML ? `<div style="margin-bottom:8px;">${tagsHTML}</div>` : ''}
      ${ch.description ? `<div class="co-desc">${ch.description}</div>` : ''}
      ${apps.length ? `<div class="co-appearances">
        ${apps.slice(0, 8).map(a => `
          <div class="co-app-item">
            <div class="co-ch">
              ${a.url ? `<a href="${a.url}" target="_blank">第${a.chapterNum}章</a>` : `第${a.chapterNum}章`}
            </div>
            <div class="co-ev">${a.chapterTitle ? a.chapterTitle + (a.event ? ' — ' : '') : ''}${a.event || ''}</div>
          </div>`).join('')}
      </div>` : ''}
    `;

    // Position near anchor
    const rect = anchorEl.getBoundingClientRect();
    popup.style.display = 'block';
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 6;
    if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
    if (top + ph > window.scrollY + window.innerHeight - 10) top = rect.top + window.scrollY - ph - 6;
    popup.style.left = Math.max(6, left) + 'px';
    popup.style.top = Math.max(6, top) + 'px';
  }

  document.addEventListener('click', e => {
    const hl = e.target.closest('.co-hl');
    if (hl) { showPopup(hl.dataset.charId, hl); return; }
    if (!popup.contains(e.target) && e.target.id !== 'co-toggle') {
      popup.style.display = 'none';
    }
  });

  document.getElementById('co-close-btn').addEventListener('click', () => {
    popup.style.display = 'none';
  });

})();
