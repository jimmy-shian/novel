const API_BASE = 'http://localhost:7788/api';

// ── State ──
const state = {
  novels: [],
  chapters: [],
  currentNovel: null,
  currentChapter: null,
  originalText: '',
  issues: [],
  warnings: [],
  decisions: {}, // issue.id -> { action: 'accept'|'ignore'|'manual', manualText?: '' }
  aiData: null, // { chars, events, summary, timeline }
  activeBatchNovel: null,
  isGlobalBatching: false,
  selectedNovels: new Set() // Selected for global batch
};

function saveSelectedNovel(name) {
  if (name) {
    localStorage.setItem('proofreader.currentNovel', name);
  } else {
    localStorage.removeItem('proofreader.currentNovel');
  }
}

function loadSelectedNovel() {
  return localStorage.getItem('proofreader.currentNovel');
}

function saveActiveBatchNovel(name) {
  if (name) {
    localStorage.setItem('proofreader.activeBatchNovel', name);
  } else {
    localStorage.removeItem('proofreader.activeBatchNovel');
  }
}

function loadActiveBatchNovel() {
  return localStorage.getItem('proofreader.activeBatchNovel');
}

const GLOBAL_BATCH_STORAGE_KEY = 'proofreader.globalBatchState';
function saveGlobalBatchState(batchState) {
  localStorage.setItem(GLOBAL_BATCH_STORAGE_KEY, JSON.stringify(batchState));
}

function loadGlobalBatchState() {
  const raw = localStorage.getItem(GLOBAL_BATCH_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse saved global batch state', err);
    return null;
  }
}

function clearGlobalBatchState() {
  localStorage.removeItem(GLOBAL_BATCH_STORAGE_KEY);
  saveActiveBatchNovel(null);
  state.activeBatchNovel = null;
}

function saveUIState() {
  const markEl = document.getElementById('chk-mark');
  const analyzeEl = document.getElementById('chk-analyze');
  const cacheEl = document.getElementById('chk-use-cache');
  const settings = {
    mark: markEl ? markEl.checked : false,
    analyze: analyzeEl ? analyzeEl.checked : false,
    useCache: cacheEl ? cacheEl.checked : false,
    selectedNovels: Array.from(state.selectedNovels)
  };
  localStorage.setItem('proofreader.uiSettings', JSON.stringify(settings));
}

function loadUIState() {
  const raw = localStorage.getItem('proofreader.uiSettings');
  if (!raw) return;
  try {
    const settings = JSON.parse(raw);
    const map = {
      'chk-mark': settings.mark,
      'chk-analyze': settings.analyze,
      'chk-use-cache': settings.useCache
    };
    for (const [id, val] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el && val !== undefined) el.checked = val;
    }
    if (settings.selectedNovels) {
      state.selectedNovels = new Set(settings.selectedNovels);
    }
  } catch(e) {
    console.error('Failed to load UI state', e);
  }
}

function saveSelectedChapter(name) {
  if (name) {
    localStorage.setItem('proofreader.currentChapter', name);
  } else {
    localStorage.removeItem('proofreader.currentChapter');
  }
}

function loadSelectedChapter() {
  return localStorage.getItem('proofreader.currentChapter');
}

// ── DOM Elements ──
const els = {
  status: document.getElementById('api-status'),
  novelList: document.getElementById('novel-list'),
  novelCount: document.getElementById('novel-count'),
  chapterList: document.getElementById('chapter-list'),
  chapterCount: document.getElementById('chapter-count'),
  currentInfo: document.getElementById('current-info'),
  actions: document.getElementById('actions'),
  tabs: document.getElementById('tabs'),
  workspace: document.getElementById('workspace'),
  emptyState: document.getElementById('empty-state'),
  editor: document.getElementById('editor-content'),
  editorManual: document.getElementById('editor-manual'),
  btnEditMode: document.getElementById('btn-edit-mode'),
  issueList: document.getElementById('issue-list'),
  batchList: document.getElementById('batch-list'),
  
  // Buttons
  btnAnalyze: document.getElementById('btn-analyze'),
  btnApply: document.getElementById('btn-apply'),
  btnExport: document.getElementById('btn-export'),
  btnBatchStart: document.getElementById('btn-batch-start'),
  btnBatchStop: document.getElementById('btn-batch-stop'),
  btnAcceptAll: document.getElementById('btn-accept-all'),
  
  // Modal
  modal: document.getElementById('modal-overlay'),
  modalInput: document.getElementById('modal-input'),
  modalCancel: document.getElementById('modal-cancel'),
  modalConfirm: document.getElementById('modal-confirm'),
  
  // Global Batch
  btnGlobalBatch: document.getElementById('btn-global-batch'),
  globalBatchUI: document.getElementById('global-batch-ui'),
  globalBatchProgress: document.getElementById('global-batch-progress'),
  globalBatchLabel: document.getElementById('global-batch-label'),
  globalBatchETA: document.getElementById('global-batch-eta'),
  globalBatchDetails: document.getElementById('global-batch-details'),
  btnGlobalStop: document.getElementById('btn-global-stop')
};

// ── Initialization ──
async function init() {
  // Load UI settings first
  loadUIState();
  
  // Set listeners for settings changes
  ['chk-mark', 'chk-analyze', 'chk-use-cache'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveUIState);
  });

  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      els.status.textContent = '已連線';
      els.status.className = 'badge ok';
      loadNovels();
    }
  } catch (err) {
    els.status.textContent = '無法連線至後端';
    els.status.className = 'badge error';
  }
}

// ── Filesystem Navigation ──
async function loadNovels() {
  try {
    const res = await fetch(`${API_BASE}/fs/novels`);
    const data = await res.json();
    state.novels = data.novels;
    renderNovels();

    const savedNovel = loadSelectedNovel();
    if (savedNovel) {
      const matched = state.novels.find(n => n.name === savedNovel);
      if (matched) {
        const btn = [...document.querySelectorAll('#novel-list .list-item')].find(el => el.textContent === matched.name);
        if (btn) selectNovel(matched, btn);
      }
    }

    const activeBatch = loadActiveBatchNovel();
    if (activeBatch === '__GLOBAL__') {
      const batchState = loadGlobalBatchState();
      if (batchState && batchState.status === 'processing') {
        if (confirm('偵測到上次中斷的「全庫自動掃描」任務，是否要繼續執行？')) {
          resumeGlobalBatchState(batchState);
        } else {
          clearGlobalBatchState();
        }
      } else {
        clearGlobalBatchState();
      }
    } else if (activeBatch) {
      const matched = state.novels.find(n => n.name === activeBatch);
      if (matched) {
        const btn = [...document.querySelectorAll('#novel-list .list-item')].find(el => el.textContent === matched.name);
        if (btn) {
          selectNovel(matched, btn);
          startBatchStatusPolling(activeBatch);
        }
      }
    }
  } catch (err) {
    console.error('Failed to load novels:', err);
    els.novelList.innerHTML = '<div class="error-text">無法載入小說清單</div>';
  }
}

function renderNovels() {
  els.novelList.innerHTML = '';
  els.novelCount.textContent = `(${state.novels.length})`;
  
  if (state.novels.length === 0) {
    els.novelList.innerHTML = '<div class="empty-text">找不到小說資料夾</div>';
    return;
  }
  
  state.novels.forEach(novel => {
    const container = document.createElement('div');
    container.className = 'list-item-container';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'novel-selector';
    chk.checked = state.selectedNovels.has(novel.name);
    chk.onclick = (e) => {
      e.stopPropagation();
      if (chk.checked) state.selectedNovels.add(novel.name);
      else state.selectedNovels.delete(novel.name);
      saveUIState();
    };

    const btn = document.createElement('button');
    btn.className = 'list-item';
    btn.textContent = novel.display_name || novel.name;
    if (state.currentNovel && state.currentNovel.name === novel.name) {
      btn.classList.add('active');
    }
    btn.onclick = () => selectNovel(novel, btn);
    
    container.appendChild(chk);
    container.appendChild(btn);
    els.novelList.appendChild(container);
  });
}

async function selectNovel(novel, btnEl) {
  const wasActive = btnEl.classList.contains('active');
  document.querySelectorAll('#novel-list .list-item').forEach(el => el.classList.remove('active'));
  
  if (wasActive) {
    state.currentNovel = null;
    state.currentChapter = null;
    state.chapters = [];
    renderChapters();
    resetWorkspace();
    return;
  }

  btnEl.classList.add('active');
  state.currentNovel = novel;
  state.currentChapter = null;
  state.chapters = [];
  state.warnings = [];
  saveSelectedNovel(novel.name);
  saveSelectedChapter(null); // Clear chapter when novel changes
  
  els.chapterList.innerHTML = '<div class="loading-text">載入中...</div>';
  els.chapterCount.textContent = '';
  resetWorkspace();
  
  try {
    const res = await fetch(`${API_BASE}/fs/chapters?novel_path=${encodeURIComponent(novel.path)}&include_cache=true`);
    const data = await res.json();
    state.chapters = data.chapters;
    renderChapters();

    // Auto-select chapter if saved
    const savedChapter = loadSelectedChapter();
    if (savedChapter) {
      const matched = state.chapters.find(c => c.name === savedChapter);
      if (matched) {
        const btn = [...document.querySelectorAll('#chapter-list .list-item')].find(el => el.textContent.includes(matched.name));
        if (btn) selectChapter(matched, btn);
      }
    }

    // Load novel-level analysis results
    await fetchNovelResults(novel.name);
  } catch (err) {
    console.error('Failed to load chapters:', err);
    els.chapterList.innerHTML = '<div class="error-text">無法載入章節清單</div>';
  }
}

/**
 * Real-time update for chapter cache badge in the sidebar
 */
function updateChapterCacheBadge(chapterName) {
  const chapterItems = els.chapterList.querySelectorAll('.chapter-item');
  for (const item of chapterItems) {
    if (item.dataset.name === chapterName) {
      const badgesContainer = item.querySelector('.meta-badges');
      if (badgesContainer && !badgesContainer.querySelector('.badge-mark')) {
        const badge = document.createElement('span');
        badge.className = 'badge-mark';
        badge.innerHTML = '<i class="fas fa-microchip"></i> 快取';
        badgesContainer.appendChild(badge);
        badge.style.animation = 'pulse-gold 2s ease-out';
      }
      break;
    }
  }
}

async function fetchNovelResults(novelId) {
  try {
    const res = await fetch(`${API_BASE}/results/${encodeURIComponent(novelId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && (data.characters || data.summary || data.timeline)) {
        state.aiData = {
          characters: data.characters || [],
          summary: data.summary || '',
          timeline: data.timeline || [],
          novel: novelId
        };
        renderAnalysis();
        console.log('已載入小說全域分析資料');
      }
    }
  } catch (err) {
    console.warn('Failed to fetch novel results:', err);
  }
}

async function saveNovelResults() {
  if (!state.currentNovel || !state.aiData) return;
  try {
    await fetch(`${API_BASE}/results/${encodeURIComponent(state.currentNovel.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.aiData)
    });
    console.log('已儲存小說全域分析資料');
  } catch (err) {
    console.error('Failed to save novel results:', err);
  }
}

function renderChapters() {
  els.chapterList.innerHTML = '';
  els.chapterCount.textContent = `(${state.chapters.length})`;
  
  if (state.chapters.length === 0) {
    els.chapterList.innerHTML = '<div class="empty-text">此資料夾沒有 .txt 檔案</div>';
    return;
  }
  
  state.chapters.forEach(chap => {
    const btn = document.createElement('button');
    btn.className = 'list-item chapter-item';
    btn.dataset.name = chap.name;
    btn.onclick = () => selectChapter(chap, btn);

    const nameWrapper = document.createElement('span');
    nameWrapper.textContent = chap.name;
    btn.appendChild(nameWrapper);

    // Meta badges container (for cache, etc.)
    const meta = document.createElement('div');
    meta.className = 'meta-badges';
    btn.appendChild(meta);

    if (chap.cache && chap.cache.done) {
      const badge = document.createElement('span');
      badge.className = 'badge-mark done';
      badge.innerHTML = '<i class="fas fa-check-circle"></i> 已校對';
      meta.appendChild(badge);
    } else if (chap.cache && (chap.cache.mark || chap.cache.events)) {
      const badge = document.createElement('span');
      badge.className = 'badge-mark';
      badge.innerHTML = '<i class="fas fa-microchip"></i> 快取';
      meta.appendChild(badge);
    }

    els.chapterList.appendChild(btn);
  });
}

async function selectChapter(chap, btnEl) {
  const wasActive = btnEl.classList.contains('active');
  document.querySelectorAll('#chapter-list .list-item').forEach(el => el.classList.remove('active'));
  
  if (wasActive) {
    state.currentChapter = null;
    resetWorkspace();
    return;
  }

  btnEl.classList.add('active');
  state.currentChapter = chap;
  saveSelectedChapter(chap.name);
  els.currentInfo.textContent = `${state.currentNovel.display_name || state.currentNovel.name} / ${chap.name}`;
  
  // Show workspace
  els.emptyState.style.display = 'none';
  els.actions.style.display = 'flex';
  els.tabs.style.display = 'flex';

  // Maintain active tab or default to proofread
  let activeTab = 'proofread';
  const activeBtn = document.querySelector('.tab-btn.active');
  if (activeBtn) {
    activeTab = activeBtn.dataset.tab;
  } else {
    document.querySelectorAll('.tab-btn').forEach(b => {
      if (b.dataset.tab === 'proofread') b.classList.add('active');
      else b.classList.remove('active');
    });
  }

  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  const activeContent = document.getElementById(`tab-${activeTab}`);
  if (activeContent) activeContent.style.display = 'block';
  
  els.editor.innerHTML = '載入中...';
  
  try {
    const res = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(chap.path)}`);
    const data = await res.json();
    state.originalText = data.content;
    state.issues = [];
    state.decisions = {};
    // state.aiData is preserved (novel-wide)
    renderEditor();
    renderIssues();
    renderAnalysis(); 
    
    // Check if cache exists and load it
    await checkAndLoadCache();
  } catch (err) {
    console.error('Failed to load file content:', err);
    els.editor.innerHTML = '無法載入檔案內容';
  }
}

async function checkAndLoadCache() {
  try {
    const res = await fetch(`${API_BASE}/cache/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_id: state.currentNovel.name,
        chapter: state.currentChapter.name,
        text: state.originalText
      })
    });
    
    if (res.ok) {
      const data = await res.json();
      let hasCache = false;
      
      if (data.mark) {
        state.issues = (data.mark.issues || []).map((issue, idx) => ({ ...issue, id: `i_${idx}` }));
        state.decisions = {};
        state.warnings = data.mark.warnings || [];
        hasCache = true;
      }
      
      if (data.chars || data.events || data.summary) {
        // Merge with existing global data if any
        const existingChars = state.aiData?.characters || [];
        const newChars = data.chars || [];
        
        // Simple deduplication by name
        const charMap = new Map();
        existingChars.forEach(c => charMap.set(c['角色名稱'], c));
        newChars.forEach(c => charMap.set(c['角色名稱'], c));

        // Merge Timeline events
        const existingEvents = state.aiData?.timeline || [];
        const newEvents = data.events || [];
        
        // Use event name + chapter as a simple key for deduplication
        const eventMap = new Map();
        existingEvents.forEach(e => eventMap.set(`${e['事件名稱']}-${e['章節']}`, e));
        newEvents.forEach(e => eventMap.set(`${e['事件名稱']}-${e['章節']}`, e));
        
        // Sort timeline by chapter number if possible
        const sortedTimeline = Array.from(eventMap.values()).sort((a, b) => {
            const getNum = s => {
                const m = String(s).match(/\d+/);
                return m ? parseInt(m[0]) : 0;
            };
            return getNum(a['章節']) - getNum(b['章節']);
        });

        state.aiData = {
          characters: Array.from(charMap.values()),
          timeline: sortedTimeline, 
          summary: data.summary || state.aiData?.summary || '', 
          novel: state.currentNovel.name
        };
        hasCache = true;
      }
      
      if (hasCache) {
        console.log('載入快取資料完成');
        renderEditor();
        renderIssues();
        renderWarnings();
        renderAnalysis();
        
        // Show a temporary indicator
        const badge = document.createElement('div');
        badge.className = 'cache-indicator';
        badge.textContent = '已載入現有分析紀錄';
        document.body.appendChild(badge);
        setTimeout(() => badge.remove(), 3000);
      }
    }
  } catch (err) {
    console.error('Cache check failed:', err);
  }
}

function resetWorkspace() {
  els.currentInfo.textContent = '請選擇章節';
  els.actions.style.display = 'none';
  els.tabs.style.display = 'none';
  els.emptyState.style.display = 'flex';
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  state.warnings = [];
  renderWarnings();
}

function renderWarnings() {
  const container = document.getElementById('issue-warnings');
  if (!container) return;
  if (!state.warnings || state.warnings.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  container.innerHTML = state.warnings.map(w => `
    <div class="warning-item">
      <strong>快取/解析提醒：</strong>
      <div>${escapeHTML(w.message || '無法定位錯誤片段')}</div>
      <div class="warning-context">${escapeHTML(w.context || '')}</div>
    </div>
  `).join('');
}

// ── AI Processing ──
els.btnAnalyze.addEventListener('click', async () => {
  if (!state.currentChapter) return;
  
  const runMark = document.getElementById('chk-mark').checked;
  const runAnalyze = document.getElementById('chk-analyze').checked;
  
  if (!runMark && !runAnalyze) {
    alert('請勾選至少一項分析任務');
    return;
  }
  
  if (runMark && state.issues.length > 0) {
    if (!confirm('本章已存在校對紀錄，確定要清除並重新啟動 AI 分析嗎？')) return;
  }
  if (runAnalyze && state.aiData) {
     if (!confirm('本章已存在分析紀錄，確定要重新啟動 AI 分析嗎？')) return;
  }
  
  els.btnAnalyze.disabled = true;
  els.btnAnalyze.textContent = 'AI 分析中...';
  
  const tasks = [];
  if (runMark) tasks.push('mark');
  if (runAnalyze) tasks.push('chars', 'events', 'summary');
  
  try {
    const res = await fetch(`${API_BASE}/analyze/full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_id: state.currentNovel.name,
        chapter: state.currentChapter.name,
        text: state.originalText,
        use_cache: document.getElementById('chk-use-cache').checked,
        tasks: tasks
      })
    });
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: '伺服器錯誤' }));
      throw new Error(errData.details || errData.error || '分析過程中發生錯誤');
    }
    
    const data = await res.json();
    
    // Check for internal task errors
    if (data.mark && data.mark.error) {
       throw new Error(`校對失敗: ${data.mark.error}`);
    }

    if (data.mark) {
      state.issues = (data.mark.issues || []).map((issue, idx) => ({ ...issue, id: `i_${idx}` }));
      state.decisions = {};
      state.warnings = data.mark.warnings || [];
      if (state.issues.length === 0 && !data.mark.error) {
          console.log('未發現任何建議修改項');
      }
    }
    
    if (runAnalyze) {
      // Merge with existing data
      const existingChars = state.aiData?.characters || [];
      const newChars = data.chars || [];
      const charMap = new Map();
      existingChars.forEach(c => charMap.set(c['角色名稱'], c));
      newChars.forEach(c => charMap.set(c['角色名稱'], c));

      const existingEvents = state.aiData?.timeline || [];
      const newEvents = data.timeline || data.events || [];
      const eventMap = new Map();
      existingEvents.forEach(e => eventMap.set(`${e['事件名稱']}-${e['章節']}`, e));
      newEvents.forEach(e => eventMap.set(`${e['事件名稱']}-${e['章節']}`, e));

      const sortedTimeline = Array.from(eventMap.values()).sort((a, b) => {
          const getNum = s => {
              const m = String(s).match(/\d+/);
              return m ? parseInt(m[0]) : 0;
          };
          return getNum(a['章節']) - getNum(b['章節']);
      });

      state.aiData = {
        characters: Array.from(charMap.values()),
        timeline: sortedTimeline,
        summary: data.summary || state.aiData?.summary || '',
        novel: state.currentNovel.name
      };
      
      console.log('角色與劇情分析完成');
      renderAnalysis();
      // Save globally
      await saveNovelResults();
    }
    
    renderEditor();
    renderIssues();
  } catch (err) {
    console.error('Analysis Error:', err);
    alert('分析失敗：' + err.message);
  } finally {
    els.btnAnalyze.disabled = false;
    els.btnAnalyze.textContent = '啟動 AI 分析';
  }
});

// ── Manual Edit Mode Toggle ──
let isManualEdit = false;

els.btnEditMode.addEventListener('click', () => {
  isManualEdit = !isManualEdit;
  
  if (isManualEdit) {
    // Switch to manual
    els.btnEditMode.textContent = '完成手動編輯';
    els.btnEditMode.classList.add('primary');
    els.btnAnalyze.disabled = true;
    
    // Get currently "applied" text (what user sees in the editor)
    // But it's easier to just use state.originalText if they haven't applied anything,
    // or if they have decisions, we should technically apply them first.
    // Let's just use the raw originalText for now, or the text with accepted decisions.
    
    const currentViewText = getProcessedText();
    els.editorManual.value = currentViewText;
    
    els.editor.style.display = 'none';
    els.editorManual.style.display = 'block';
    els.editorManual.focus();
  } else {
    // Switch back to AI mode
    els.btnEditMode.textContent = '進入手動編輯';
    els.btnEditMode.classList.remove('primary');
    els.btnAnalyze.disabled = false;
    
    state.originalText = els.editorManual.value;
    state.issues = [];
    state.decisions = {};
    
    els.editor.style.display = 'block';
    els.editorManual.style.display = 'none';
    renderEditor();
    renderIssues();
  }
});

function getProcessedText() {
  if (state.issues.length === 0) return state.originalText;
  
  const sorted = [...state.issues].sort((a, b) => b.start - a.start);
  let text = state.originalText;
  
  for (const issue of sorted) {
    const dec = state.decisions[issue.id];
    if (dec?.action === 'accept') {
      text = text.slice(0, issue.start) + issue.suggestion + text.slice(issue.end);
    } else if (dec?.action === 'manual') {
      text = text.slice(0, issue.start) + dec.manualText + text.slice(issue.end);
    }
  }
  return text;
}

// ── Rendering Editor & Issues ──
function renderEditor() {
  if (!state.originalText) {
    els.editor.innerHTML = '<div class="empty-text">請選擇章節</div>';
    return;
  }
  
  // Create a copy and sort by start ascending
  const sortedIssues = [...state.issues].sort((a, b) => a.start - b.start);
  
  let html = '';
  let lastIdx = 0;
  
  for (const issue of sortedIssues) {
    // Avoid overlap
    if (issue.start < lastIdx) continue;
    
    // Text before the mark
    html += escapeHTML(state.originalText.slice(lastIdx, issue.start));
    
    const dec = state.decisions[issue.id];
    let actionClass = dec ? `hl-${dec.action}` : `hl-${issue.type}`;
    
    // What text to show in the mark
    let displayStr = issue.original;
    if (dec?.action === 'accept') displayStr = issue.suggestion;
    else if (dec?.action === 'manual') displayStr = dec.manualText;
    
    html += `<mark class="hl ${actionClass}" data-id="${issue.id}" data-tooltip="${escapeHTML(issue.reason || '')}">${escapeHTML(displayStr)}</mark>`;
    lastIdx = issue.end;
  }
  
  // Remaining text
  html += escapeHTML(state.originalText.slice(lastIdx));
  
  els.editor.innerHTML = html;
  
  // Bind events
  els.editor.querySelectorAll('mark.hl').forEach(mark => {
    const id = mark.dataset.id;
    const card = document.getElementById(`card-${id}`);
    
    mark.addEventListener('click', () => {
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.querySelectorAll('.issue-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
      }
    });

    mark.addEventListener('mouseenter', () => {
      if (card) card.classList.add('hover-sync');
    });
    mark.addEventListener('mouseleave', () => {
      if (card) card.classList.remove('hover-sync');
    });
  });
}

function renderIssues(filterType = 'all') {
  els.issueList.innerHTML = '';
  
  let filtered = state.issues;
  if (filterType !== 'all') {
    filtered = state.issues.filter(i => i.type === filterType);
  }
  
  if (filtered.length === 0) {
    els.issueList.innerHTML = '<div class="empty-text">目前沒有待處理的問題</div>';
    return;
  }

  // Grouping logic: group by type + original + suggestion
  const groups = [];
  const groupMap = new Map();

  filtered.forEach(issue => {
    const key = `${issue.type}|${issue.original}|${issue.suggestion}`;
    if (!groupMap.has(key)) {
      const group = {
        key,
        type: issue.type,
        original: issue.original,
        suggestion: issue.suggestion,
        reason: issue.reason,
        items: []
      };
      groupMap.set(key, group);
      groups.push(group);
    }
    groupMap.get(key).items.push(issue);
  });
  
  groups.forEach(group => {
    const firstIssue = group.items[0];
    const dec = state.decisions[firstIssue.id];
    let cardClass = 'issue-card';
    if (dec) cardClass += ` i-${dec.action}`;
    if (group.items.length > 1) cardClass += ' is-group';
    
    const card = document.createElement('div');
    card.className = cardClass;
    card.id = `card-${firstIssue.id}`;
    
    const isGroup = group.items.length > 1;
    const countBadge = isGroup ? `<span class="count-badge">${group.items.length} 處</span>` : '';
    const accLabel = isGroup ? '全部接受' : '接受';
    const ignLabel = isGroup ? '全部忽略' : '忽略';
    
    card.innerHTML = `
      <div class="issue-top">
        <span class="type-badge ${group.type}">${group.type}</span>
        ${countBadge}
        <span class="issue-orig">${escapeHTML(group.original)}</span>
        <span style="color:#aaa">➔</span>
        <span class="issue-suggest">${escapeHTML(group.suggestion)}</span>
      </div>
      <div class="issue-reason">${escapeHTML(group.reason)}</div>
      <div class="issue-actions">
        <button class="btn-acc" data-act="accept">${accLabel}</button>
        <button class="btn-ign" data-act="ignore">${ignLabel}</button>
        <button class="btn-man" data-act="manual">手動</button>
      </div>
    `;

    // Scroll to mark on click
    card.addEventListener('click', () => {
      const firstMark = els.editor.querySelector(`mark[data-id="${firstIssue.id}"]`);
      if (firstMark) {
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Add a temporary highlight effect to the mark
        firstMark.classList.add('flash-highlight');
        setTimeout(() => firstMark.classList.remove('flash-highlight'), 1500);
      }
    });

    // Hover sync: highlight all marks in this group
    card.addEventListener('mouseenter', () => {
      group.items.forEach(issue => {
        const marks = els.editor.querySelectorAll(`mark[data-id="${issue.id}"]`);
        marks.forEach(m => m.classList.add('hover-sync'));
      });
    });
    card.addEventListener('mouseleave', () => {
      group.items.forEach(issue => {
        const marks = els.editor.querySelectorAll(`mark[data-id="${issue.id}"]`);
        marks.forEach(m => m.classList.remove('hover-sync'));
      });
    });
    
    card.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.act;
        if (action === 'manual') {
          openModal(group.items); // Special case for group manual edit
        } else {
          group.items.forEach(issue => {
            state.decisions[issue.id] = { action };
          });
          updateAfterDecision();
        }
      });
    });
    
    els.issueList.appendChild(card);
  });
}

// ── User Actions ──
function handleDecision(issue, action) {
  if (action === 'manual') {
    openModal(issue);
  } else {
    state.decisions[issue.id] = { action };
    updateAfterDecision();
  }
}

els.btnAcceptAll.addEventListener('click', () => {
  state.issues.forEach(issue => {
    if (!state.decisions[issue.id]) {
      state.decisions[issue.id] = { action: 'accept' };
    }
  });
  updateAfterDecision();
});

function updateAfterDecision() {
  renderEditor();
  const filter = document.querySelector('.filter-btn.active').dataset.filter;
  renderIssues(filter);
  renderWarnings();
}

// ── Manual Edit Modal ──
let activeIssuesForModal = [];

function openModal(issues) {
  activeIssuesForModal = Array.isArray(issues) ? issues : [issues];
  els.modalInput.value = activeIssuesForModal[0].original;
  els.modal.style.display = 'flex';
  els.modalInput.focus();
}

els.modalCancel.addEventListener('click', () => {
  els.modal.style.display = 'none';
  activeIssuesForModal = [];
});

els.modalConfirm.addEventListener('click', () => {
  if (activeIssuesForModal.length > 0) {
    const val = els.modalInput.value.trim();
    if (val) {
      activeIssuesForModal.forEach(issue => {
        state.decisions[issue.id] = { action: 'manual', manualText: val };
      });
      updateAfterDecision();
    }
  }
  els.modal.style.display = 'none';
  activeIssuesForModal = [];
});

// ── Apply & Export ──
els.btnApply.addEventListener('click', async () => {
  if (!state.currentChapter) return;
  
  // Format decisions for backend
  const payloadDecisions = [];
  for (const issue of state.issues) {
    const dec = state.decisions[issue.id];
    if (!dec) continue; // Unresolved issues remain unchanged
    payloadDecisions.push({
      ...issue,
      action: dec.action,
      manual_text: dec.manualText || ''
    });
  }
  
  els.btnApply.disabled = true;
  els.btnApply.textContent = '儲存中...';
  
  try {
    const res = await fetch(`${API_BASE}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_id: state.currentNovel.name,
        chapter: state.currentChapter.name,
        text: state.originalText,
        decisions: payloadDecisions
      })
    });
    
    const data = await res.json();
    alert(`儲存成功！\n儲存路徑：${data.saved_to}`);
    
    // Reload chapter text
    const readRes = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(state.currentChapter.path)}`);
    const readData = await readRes.json();
    state.originalText = readData.content;
    state.issues = [];
    state.decisions = {};
    renderEditor();
    renderIssues();
    
  } catch (err) {
    console.error(err);
    alert('儲存失敗');
  } finally {
    els.btnApply.disabled = false;
    els.btnApply.textContent = '儲存至檔案';
  }
});

els.btnExport.addEventListener('click', async () => {
  if (!state.aiData || !state.currentNovel) {
    alert('請先勾選「角色/劇情分析」並執行 AI 分析後，再進行匯出！');
    return;
  }
  
  try {
    const res = await fetch(`${API_BASE}/export/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_id: state.currentNovel.name,
        data: state.aiData
      })
    });
    const result = await res.json();
    if (result.success) {
      alert('已成功匯出至閱讀助手資料夾：\n' + result.path);
    }
  } catch (err) {
    console.error(err);
    alert('匯出失敗');
  }
});

// ── Tab & Filter Logic ──
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).style.display = 'block';
  });
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderIssues(btn.dataset.filter);
  });
});

// ── Batch Processing ──
els.btnBatchStart.addEventListener('click', async () => {
  if (!state.currentNovel || state.chapters.length === 0) return;
  if (!confirm(`確定要批次掃描 ${state.currentNovel.name} 的 ${state.chapters.length} 個章節嗎？這可能需要一段時間。`)) return;
  
  els.btnBatchStart.disabled = true;
  els.btnBatchStop.style.display = 'inline-block';
  state.isBatching = true;
  els.batchList.innerHTML = '<div class="loading-text">正在讀取所有檔案內容...</div>';
  
  try {
    const requestedTasks = [];
    if (document.getElementById('chk-mark').checked) requestedTasks.push('mark');
    if (document.getElementById('chk-analyze').checked) {
      requestedTasks.push('chars');
      requestedTasks.push('events');
      requestedTasks.push('summary');
    }
    if (requestedTasks.length === 0) requestedTasks.push('mark');

    const startBody = requestedTasks.length === 1 && requestedTasks[0] === 'mark'
      ? { novel_id: state.currentNovel.name, files: [], use_cache: document.getElementById('chk-use-cache').checked }
      : { novel_id: state.currentNovel.name, use_cache: document.getElementById('chk-use-cache').checked, tasks: requestedTasks };

    const endpoint = requestedTasks.length === 1 && requestedTasks[0] === 'mark'
      ? `${API_BASE}/batch/mark`
      : `${API_BASE}/batch/scan`;

    let startRes;
    if (endpoint.endsWith('/batch/mark')) {
      const filesData = [];
      for (const chap of state.chapters) {
        const res = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(chap.path)}`);
        const data = await res.json();
        filesData.push({
          filename: chap.name,
          chapter: chap.name,
          content: data.content
        });
      }
      startRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...startBody, files: filesData })
      });
    } else {
      startRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(startBody)
      });
    }
    if (!startRes.ok) throw new Error(`批次啟動失敗：${startRes.status}`);

    saveActiveBatchNovel(state.currentNovel.name);
    state.activeBatchNovel = state.currentNovel.name;
    els.batchList.innerHTML = '<div class="loading-text">批次任務已啟動，請稍候...</div>';
    startBatchStatusPolling(state.currentNovel.name);
  } catch (err) {
    console.error(err);
    alert('啟動批次任務失敗');
    els.btnBatchStart.disabled = false;
  }
});

// Batch Stop
els.btnBatchStop.addEventListener('click', async () => {
  if (!state.currentNovel) return;
  if (!confirm(`確定要停止 ${state.currentNovel.name} 的批次處理嗎？`)) return;
  
  try {
    const res = await fetch(`${API_BASE}/batch/stop/${encodeURIComponent(state.currentNovel.name)}`, {
      method: 'POST'
    });
    if (res.ok) {
      state.isBatching = false;
      els.btnBatchStart.disabled = false;
      els.btnBatchStop.style.display = 'none';
    }
  } catch (err) {
    console.error('Stop batch error:', err);
  }
});

function startBatchStatusPolling(novelName) {
  let timer = null;
  const updateStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/batch/status/${encodeURIComponent(novelName)}`);
      if (!res.ok) throw new Error('無法取得批次狀態');
      const data = await res.json();
      
      if (data.status === 'not_found') {
        els.batchList.innerHTML = '<div class="error-text">未找到批次任務狀態</div>';
        saveActiveBatchNovel(null);
        state.activeBatchNovel = null;
        els.btnBatchStart.disabled = false;
        els.btnBatchStop.style.display = 'none';
        state.isBatching = false;
        if (timer) clearTimeout(timer);
        return;
      }
      
      if (data.status === 'done' || data.status === 'idle') {
        renderBatchStatus(data);
        saveActiveBatchNovel(null);
        state.activeBatchNovel = null;
        els.btnBatchStart.disabled = false;
        els.btnBatchStop.style.display = 'none';
        state.isBatching = false;
        if (timer) clearTimeout(timer);
        return;
      }

      if (data.last_chapter) {
        updateChapterCacheBadge(data.last_chapter);
      }

      renderBatchStatus(data);
    } catch (pollErr) {
      console.error('Batch status poll failed:', pollErr);
      if (timer) clearInterval(timer);
      els.batchList.innerHTML = '<div class="error-text">無法取得批次狀態，請稍後重試</div>';
      saveActiveBatchNovel(null);
      state.activeBatchNovel = null;
      els.btnBatchStart.disabled = false;
    }
  };

  function renderBatchStatus(data) {
    const executed = data.current || 0;
    const total = data.total || 0;
    const remaining = Math.max(0, total - executed);
    const elapsedMs = data.start_time ? Date.now() - new Date(data.start_time).getTime() : 0;
    const avgMsPerItem = executed > 0 ? elapsedMs / executed : 0;
    const estimatedRemainingMs = Math.round(avgMsPerItem * remaining);
    
    els.batchList.innerHTML = `
      <div class="batch-item">
        <span>批次進度</span>
        <strong>${executed} / ${total}</strong>
      </div>
      <div class="batch-item">
        <span>已執行</span>
        <strong>${formatDuration(elapsedMs)}</strong>
        <span>剩餘</span>
        <strong>${formatDuration(estimatedRemainingMs)}</strong>
      </div>
      ${data.failed ? `<div class="batch-item warning-text">失敗：${data.failed}</div>` : ''}
    `;
  }

  updateStatus();
  timer = setInterval(updateStatus, 2000);
}

// ── Rendering Analysis ──
function renderAnalysis() {
  const containerSummary = document.getElementById('analysis-summary');
  const containerChars = document.getElementById('analysis-characters');
  const containerTimeline = document.getElementById('analysis-timeline');
  
  if (!state.aiData) {
    containerSummary.textContent = '尚未分析';
    containerChars.innerHTML = '';
    containerTimeline.innerHTML = '';
    return;
  }
  
  // Summary
  if (state.aiData.summary) {
    containerSummary.innerHTML = marked.parse(state.aiData.summary);
  } else {
    containerSummary.textContent = '無大綱資料';
  }
  
  // Characters
  containerChars.innerHTML = '';
  if (state.aiData.characters.length === 0) {
    containerChars.innerHTML = '<div class="empty-text">未偵測到角色</div>';
  } else {
    state.aiData.characters.forEach(char => {
      const card = document.createElement('div');
      card.className = 'char-card';
      
      const name = escapeHTML(char['角色名稱'] || '未知');
      const aliases = char['別名'] && char['別名'].length > 0 
        ? `<span class="char-aliases">(${escapeHTML(char['別名'].join(', '))})</span>` 
        : '';
      const faction = escapeHTML(char['身份'] || '');
      const desc = escapeHTML(char['角色描述'] || '');
      
      card.innerHTML = `
        <div class="char-name">
          ${name} ${aliases}
        </div>
        <div class="char-faction">${faction}</div>
        <div class="char-desc">${desc}</div>
      `;
      containerChars.appendChild(card);
    });
  }
  
  // Timeline
  containerTimeline.innerHTML = '';
  if (state.aiData.timeline.length === 0) {
    containerTimeline.innerHTML = '<div class="empty-state">未偵測到事件</div>';
  } else {
    state.aiData.timeline.forEach(ev => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      item.innerHTML = `
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-header">
            <span class="timeline-title">${escapeHTML(ev['事件名稱'] || '未知事件')}</span>
            <span class="timeline-chapter">${escapeHTML(ev['章節'] || '')}</span>
          </div>
          <div class="timeline-desc">${escapeHTML(ev['事件描述'] || '')}</div>
          <div class="timeline-tags">
            ${(ev['涉及角色'] || []).map(c => `<span class="tag">${escapeHTML(c)}</span>`).join('')}
            <span class="tag" style="background:#fffcf0; border-color:#d4c4a8;">重要性: ${escapeHTML(ev['重要性'] || '中')}</span>
          </div>
        </div>
      `;
      containerTimeline.appendChild(item);
    });
  }
}

// ── Utils ──
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    String(days).padStart(2, '0'),
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0')
  ].join(':');
}

function getSavedBatchNovel() {
  const active = loadActiveBatchNovel();
  if (active) {
    state.activeBatchNovel = active;
  }
  return active;
}

function renderGlobalBatchView(batchState, currentStatus = null) {
  const executed = Math.min(
    batchState.totalChapters,
    batchState.completedChapters + (currentStatus?.current || 0)
  );
  const total = batchState.totalChapters;
  const elapsedMs = batchState.startTime ? Date.now() - new Date(batchState.startTime).getTime() : 0;
  const remaining = Math.max(0, total - executed);
  const avgMsPerItem = executed > 0 ? elapsedMs / executed : 0;
  const remainingMs = Math.round(avgMsPerItem * remaining);
  const pct = total > 0 ? Math.min(100, (executed / total) * 100) : 0;
  const currentNovelName = currentStatus?.novelName || batchState.currentNovel || '未知章節';

  els.globalBatchUI.style.display = 'block';
  els.globalBatchProgress.style.width = `${pct}%`;
  els.globalBatchLabel.textContent = `正在處理: ${currentNovelName}`;
  els.globalBatchDetails.textContent = `當前章節: ${currentNovelName}，剩餘章節: ${remaining}`;
  els.globalBatchETA.textContent = `已執行 ${formatDuration(elapsedMs)} / 剩餘 ${formatDuration(remainingMs)}`;
}

function finalizeGlobalBatch(batchState) {
  batchState.status = 'done';
  saveGlobalBatchState(batchState);
  els.globalBatchLabel.textContent = '全庫自動掃描完成！';
  els.globalBatchProgress.style.width = '100%';
  els.batchList.innerHTML = `<div class="batch-item done-text">全庫自動掃描完成！</div>`;
  els.btnGlobalBatch.textContent = '掃描完成';
  els.btnGlobalBatch.disabled = false;
  if (els.btnGlobalStop) els.btnGlobalStop.style.display = 'none';
  state.isGlobalBatching = false;
  clearGlobalBatchState();
}

async function resumeGlobalBatchState(batchState) {
  if (!batchState || batchState.status !== 'processing') {
    clearGlobalBatchState();
    return;
  }

  state.isGlobalBatching = true;
  state.activeBatchNovel = '__GLOBAL__';
  saveActiveBatchNovel('__GLOBAL__');
  els.btnGlobalBatch.disabled = true;
  els.btnGlobalBatch.textContent = '批次處理運行中...';
  if (els.btnGlobalStop) els.btnGlobalStop.style.display = 'inline-block';
  renderGlobalBatchView(batchState);
  await pollGlobalBatchForCurrentGlobalState(batchState);
}

async function pollGlobalBatchForCurrentGlobalState(batchState) {
  let timer = null;

  const step = async () => {
    if (!batchState.novelPlan || batchState.currentNovelIndex >= batchState.novelPlan.length) {
      finalizeGlobalBatch(batchState);
      clearInterval(timer);
      return;
    }

    const novelName = batchState.novelPlan[batchState.currentNovelIndex].name;
    const statusRes = await fetch(`${API_BASE}/batch/status/${encodeURIComponent(novelName)}`);
    if (!statusRes.ok) {
      console.error('無法取得 global batch 狀態');
      return;
    }
    const statusData = await statusRes.json();
    const currentStatus = {
      current: statusData.current || 0,
      novelName
    };

    if (statusData.status === 'processing') {
      renderGlobalBatchView(batchState, currentStatus);
      return;
    }

    if (statusData.status === 'done' || statusData.status === 'idle') {
      const currentCount = batchState.novelPlan[batchState.currentNovelIndex].count;
      if (batchState.completedChapters < batchState.totalChapters) {
        batchState.completedChapters = Math.min(batchState.totalChapters, batchState.completedChapters + currentCount);
      }
      batchState.currentNovelIndex += 1;
      batchState.currentNovel = batchState.novelPlan[batchState.currentNovelIndex]?.name || null;
      saveGlobalBatchState(batchState);

      if (batchState.currentNovelIndex >= batchState.novelPlan.length) {
        finalizeGlobalBatch(batchState);
        clearInterval(timer);
        return;
      }

      renderGlobalBatchView(batchState, { current: 0, novelName: batchState.currentNovel });
      return;
    }

    if (statusData.status === 'not_found') {
      console.error('Global batch current novel status not found:', novelName);
      renderGlobalBatchView(batchState, { current: 0, novelName });
    }
  };

  await step();
  timer = setInterval(step, 2000);
}

// ── Global Batch Processing ──
els.btnGlobalBatch.addEventListener('click', async () => {
  if (state.isGlobalBatching) return;
  state.isGlobalBatching = true;
  saveActiveBatchNovel('__GLOBAL__');
  els.btnGlobalBatch.disabled = true;
  els.btnGlobalBatch.textContent = '批次處理運行中...';
  if (els.btnGlobalStop) els.btnGlobalStop.style.display = 'inline-block';
  els.globalBatchUI.style.display = 'block';

  try {
    const novelRes = await fetch(`${API_BASE}/fs/novels`);
    const novelData = await novelRes.json();
    let novels = novelData.novels;

    // Filter by selection
    if (state.selectedNovels.size > 0) {
      novels = novels.filter(n => state.selectedNovels.has(n.name));
    } else {
      if (!confirm('尚未勾選任何小說，是否要掃描「全庫」所有小說？')) {
        state.isGlobalBatching = false;
        els.btnGlobalBatch.disabled = false;
        els.btnGlobalBatch.textContent = '全庫自動校對';
        return;
      }
    }

    let totalChapters = 0;
    let completedChapters = 0;
    const startTime = Date.now();

    // First, count total chapters
    const chaptersByNovel = [];
    for (const novel of novels) {
      const cRes = await fetch(`${API_BASE}/fs/chapters?novel_path=${encodeURIComponent(novel.path)}`);
      const cData = await cRes.json();
      totalChapters += cData.chapters.length;
      chaptersByNovel.push({ novel, chapters: cData.chapters });
    }

    const novelPlan = chaptersByNovel.map(item => ({
      name: item.novel.name,
      count: item.chapters.length
    }));

    const globalBatchState = {
      type: 'global',
      totalChapters,
      completedChapters: 0,
      currentNovelIndex: 0,
      currentNovel: novelPlan.length > 0 ? novelPlan[0].name : null,
      novelPlan,
      startTime: Date.now(),
      status: 'processing'
    };
    saveActiveBatchNovel('__GLOBAL__');
    saveGlobalBatchState(globalBatchState);

    if (totalChapters === 0) {
      els.globalBatchLabel.textContent = '庫中沒有可處理的章節';
      clearGlobalBatchState();
      state.isGlobalBatching = false;
      els.btnGlobalBatch.disabled = false;
      return;
    }

    // Process each novel
    for (let index = 0; index < chaptersByNovel.length; index++) {
      const item = chaptersByNovel[index];
      globalBatchState.currentNovelIndex = index;
      globalBatchState.currentNovel = item.novel.name;
      saveGlobalBatchState(globalBatchState);
      els.globalBatchLabel.textContent = `正在處理: ${item.novel.name}`;
      
      try {
        // Gather selected tasks
        const requestedTasks = [];
        if (document.getElementById('chk-mark').checked) requestedTasks.push('mark');
        if (document.getElementById('chk-analyze').checked) {
          requestedTasks.push('chars');
          requestedTasks.push('events');
          requestedTasks.push('summary');
        }

        // Start batch for this novel
        const startRes = await fetch(`${API_BASE}/batch/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            novel_id: item.novel.name,
            use_cache: document.getElementById('chk-use-cache').checked,
            tasks: requestedTasks.length > 0 ? requestedTasks : ['mark']
          })
        });
        
        if (!startRes.ok) throw new Error(`HTTP ${startRes.status}`);

        // Poll status for this novel
        let isDone = false;
        while (!isDone) {
          const statusRes = await fetch(`${API_BASE}/batch/status/${encodeURIComponent(item.novel.name)}`);
          if (!statusRes.ok) break;
          
          const statusData = await statusRes.json();
          
          if (statusData.status === 'done' || statusData.status === 'idle') {
            isDone = true;
          } else {
            const novelCurrent = statusData.current || 0;
            const currentProgress = completedChapters + novelCurrent;
            const pct = Math.min(100, (currentProgress / totalChapters) * 100);
            
            if (statusData.last_chapter) {
              updateChapterCacheBadge(statusData.last_chapter);
            }

            const elapsedMs = Date.now() - startTime;
            const remainingChunks = Math.max(0, totalChapters - currentProgress);
            const avgMsPerChapter = currentProgress > 0 ? elapsedMs / currentProgress : 0;
            const estimatedRemainingMs = Math.round(avgMsPerChapter * remainingChunks);
            
            els.globalBatchProgress.style.width = `${pct}%`;
            els.globalBatchDetails.textContent = `當前進度: ${currentProgress} / ${totalChapters} (${item.novel.name})`;
            els.globalBatchETA.textContent = `已執行 ${formatDuration(elapsedMs)} / 剩餘 ${formatDuration(estimatedRemainingMs)}`;
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (novelErr) {
        console.error(`Error processing ${item.novel.name}:`, novelErr);
      }
      completedChapters += item.chapters.length;
      globalBatchState.completedChapters = completedChapters;
      saveGlobalBatchState(globalBatchState);
    }

    els.globalBatchLabel.textContent = '全庫自動掃描完成！';
    els.globalBatchProgress.style.width = '100%';
    els.btnGlobalBatch.textContent = '掃描完成';
    clearGlobalBatchState();
  } catch (err) {
    console.error(err);
    els.globalBatchLabel.textContent = '批次處理出錯';
    clearGlobalBatchState();
  } finally {
    state.isGlobalBatching = false;
    els.btnGlobalBatch.disabled = false;
    if (els.btnGlobalStop) els.btnGlobalStop.style.display = 'none';
  }
});

els.btnGlobalStop?.addEventListener('click', async () => {
  if (confirm('確定要停止當前的全庫自動掃描嗎？這將清除目前的進度。')) {
    // Notify backend to stop the background task
    const novelId = state.activeBatchNovel || state.currentNovel?.name;
    if (novelId) {
      try {
        await fetch(`${API_BASE}/batch/stop/${encodeURIComponent(novelId)}`, { method: 'POST' });
      } catch (err) {
        console.error('Failed to stop backend batch:', err);
      }
    }
    
    state.isGlobalBatching = false;
    clearGlobalBatchState();
    location.reload(); // Hard reset to stop all frontend loops
  }
});

// Start app
init();
