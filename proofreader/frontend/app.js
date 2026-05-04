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
  aiData: null, // { chars, events, summary, timeline, aggregate_summary, aggregate_characters, aggregate_timeline }
  activeBatchNovel: null,
  isGlobalBatching: false,
  selectedNovels: new Set(), // Selected for global batch
  scopeSummary: 'global',   // 'chapter' | 'global'
  scopeChars:   'global'    // 'chapter' | 'global'
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
  btnGlobalStop: document.getElementById('btn-global-stop'),

  // Scope toggles & consolidate
  btnConsolidate: document.getElementById('btn-consolidate'),
  btnConsolidateChars: document.getElementById('btn-consolidate-chars'),
  btnRebuildTimeline: document.getElementById('btn-rebuild-timeline'),
  scopeSummaryChapter: document.getElementById('scope-summary-chapter'),
  scopeSummaryGlobal: document.getElementById('scope-summary-global'),
  scopeCharsChapter: document.getElementById('scope-chars-chapter'),
  scopeCharsGlobal: document.getElementById('scope-chars-global'),
  
  // Context Menu & Pane Toggle
  contextMenu: document.getElementById('context-menu'),
  btnTogglePane: document.getElementById('btn-toggle-pane')
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

  initScopeToggles();

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
function updateChapterCacheBadge(chapterName, status = 'mark') {
  const chapterItems = els.chapterList.querySelectorAll('.chapter-item');
  for (const item of chapterItems) {
    if (item.dataset.name === chapterName) {
      const badgesContainer = item.querySelector('.meta-badges');
      if (badgesContainer) {
        // Clear existing mark badges if updating to applied
        if (status === 'applied') {
           const existing = badgesContainer.querySelectorAll('.badge-mark');
           existing.forEach(e => e.remove());
        }

        if (status === 'applied') {
          const badge = document.createElement('span');
          badge.className = 'badge-mark done';
          badge.innerHTML = '<i class="fas fa-check-double"></i> 已完成';
          badgesContainer.appendChild(badge);
          badge.style.animation = 'pulse-green 2s ease-out';
        } else if (!badgesContainer.querySelector('.badge-mark.checked') && !badgesContainer.querySelector('.badge-mark.done')) {
          const badge = document.createElement('span');
          badge.className = 'badge-mark checked';
          badge.innerHTML = '<i class="fas fa-check-circle"></i> 已校對';
          badgesContainer.appendChild(badge);
          badge.style.animation = 'pulse-gold 2s ease-out';
        }
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
          // Per-chapter fields (empty until a chapter is analysed)
          chars: [],
          events: [],
          summary: '',
          // Global / novel-level fields
          characters: data.characters || [],
          timeline: data.timeline || [],
          aggregate_summary: data.aggregate_summary || data.summary || '',
          aggregate_characters: data.aggregate_characters || data.characters || [],
          aggregate_timeline: data.timeline || [],
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

    // Strict priority: Applied (Finished) > Mark (Analyzed) > Events (Cached)
    if (chap.cache && chap.cache.applied) {
      const badge = document.createElement('span');
      badge.className = 'badge-mark done';
      badge.innerHTML = '<i class="fas fa-check-double"></i> 已完成';
      meta.appendChild(badge);
    } else if (chap.cache && chap.cache.mark) {
      const badge = document.createElement('span');
      badge.className = 'badge-mark checked';
      badge.innerHTML = '<i class="fas fa-check-circle"></i> 已校對';
      meta.appendChild(badge);
    } else if (chap.cache && chap.cache.events) {
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
      
      if (data.chars || data.events || data.summary || data.chapter_summary) {
        const existingChars = state.aiData?.aggregate_characters || state.aiData?.characters || [];
        const newChars = data.chars || [];

        const charMap = new Map();
        existingChars.forEach(c => charMap.set(c['角色名稱'], c));
        newChars.forEach(c => charMap.set(c['角色名稱'], c));

        // Merge Timeline events
        const existingEvents = state.aiData?.aggregate_timeline || state.aiData?.timeline || [];
        const newEvents = data.events || [];
        const eventMap = new Map();
        existingEvents.forEach(e => eventMap.set(`${e['事件名稱']}-${e['章節']}`, e));
        newEvents.forEach(e => eventMap.set(`${e['事件名稱']}-${e['章節']}`, e));

        const sortedTimeline = Array.from(eventMap.values()).sort((a, b) => {
            return naturalSort(a['章節'], b['章節']);
        });

        state.aiData = {
          // Chapter-level (what was cached for this chapter only)
          chars: newChars,
          events: newEvents,
          chapter_summary: data.chapter_summary || '',  // Single chapter summary text
          // Novel-level aggregate
          summary: data.summary || '',                   // All chapters concatenated
          characters: Array.from(charMap.values()),
          aggregate_characters: Array.from(charMap.values()),
          timeline: sortedTimeline,
          aggregate_timeline: sortedTimeline,
          aggregate_summary: data.aggregate_summary || state.aiData?.aggregate_summary || '',
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
      const existingAggChars = state.aiData?.aggregate_characters || state.aiData?.characters || [];
      const newChars = data.chars || [];
      const charMap = new Map();
      existingAggChars.forEach(c => charMap.set(c['角色名稱'], c));
      newChars.forEach(c => charMap.set(c['角色名稱'], c));

      const existingEvents = state.aiData?.aggregate_timeline || state.aiData?.timeline || [];
      const newEvents = data.aggregate_timeline || data.timeline || data.events || [];
      const eventMap = new Map();
      existingEvents.forEach(e => eventMap.set(`${e['事件名稱']}-${e['章節']}`, e));
      newEvents.forEach(e => eventMap.set(`${e['事件名稱']}-${e['章節']}`, e));

      const sortedTimeline = Array.from(eventMap.values()).sort((a, b) => {
          return naturalSort(a['章節'], b['章節']);
      });

      const aggChars = data.aggregate_characters || Array.from(charMap.values());

      state.aiData = {
        // Chapter-level (what the LLM returned for this chapter only)
        chars: data.chars || [],
        events: data.events || [],
        chapter_summary: data.chapter_summary || '',   // Single chapter summary
        // Novel-level aggregate
        summary: data.summary || '',                   // All chapters concatenated
        characters: aggChars,
        aggregate_characters: aggChars,
        timeline: sortedTimeline,
        aggregate_timeline: sortedTimeline,
        aggregate_summary: data.aggregate_summary || state.aiData?.aggregate_summary || '',
        novel: state.currentNovel.name
      };

      console.log('角色與劇情分析完成');
      renderAnalysis();
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
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

    // 右鍵選單事件
    mark.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const issue = state.issues.find(i => i.id == id);
      if (issue) {
        showContextMenu(e.pageX, e.pageY, issue);
      }
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
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    updateChapterCacheBadge(state.currentChapter.name, 'applied');
    
  } catch (err) {
    console.error(err);
    alert('儲存失敗');
  } finally {
    els.btnApply.disabled = false;
    els.btnApply.textContent = '儲存至檔案';
  }
});

els.btnExport.addEventListener('click', async () => {
  if (!state.currentNovel) {
    alert('請先選擇一個小說，再進行匯出！');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/export/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_id: state.currentNovel.name,
        data: {}  // backend now always uses global results.json, this field is ignored
      })
    });
    const result = await res.json();
    if (result.success) {
      alert('已成功匯出至閱讀助手資料夾（使用全書整合資料）：\n' + result.path);
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
  const targetNovelId = state.activeBatchNovel || (state.currentNovel ? state.currentNovel.name : null);
  if (!targetNovelId) return;
  
  if (!confirm(`確定要停止批次處理嗎？`)) return;
  
  try {
    const res = await fetch(`${API_BASE}/batch/stop/${encodeURIComponent(targetNovelId)}`, {
      method: 'POST'
    });
    if (res.ok) {
      state.isBatching = false;
      els.btnBatchStart.disabled = false;
      els.btnBatchStop.style.display = 'none';
      saveActiveBatchNovel(null);
      state.activeBatchNovel = null;
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

// ── Scope Toggles & Consolidate ──
function initScopeToggles() {
  // Summary scope
  [els.scopeSummaryChapter, els.scopeSummaryGlobal].forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      state.scopeSummary = btn.dataset.scope;
      els.scopeSummaryChapter.classList.toggle('active', state.scopeSummary === 'chapter');
      els.scopeSummaryGlobal.classList.toggle('active', state.scopeSummary === 'global');
      renderAnalysis();
    });
  });

  // Characters scope
  [els.scopeCharsChapter, els.scopeCharsGlobal].forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      state.scopeChars = btn.dataset.scope;
      els.scopeCharsChapter.classList.toggle('active', state.scopeChars === 'chapter');
      els.scopeCharsGlobal.classList.toggle('active', state.scopeChars === 'global');
      renderAnalysis();
    });
  });

  // Consolidate button
  if (els.btnConsolidate) {
    els.btnConsolidate.addEventListener('click', async () => {
      if (!state.currentNovel) { alert('請先選擇小說'); return; }
      els.btnConsolidate.disabled = true;
      els.btnConsolidate.textContent = '整合中...';
      try {
        const res = await fetch(`${API_BASE}/novel/consolidate_summary/${encodeURIComponent(state.currentNovel.name)}`, {
          method: 'POST'
        });
        const data = await res.json();
        if (data.summary && state.aiData) {
          state.aiData.aggregate_summary = data.summary;
          // Also auto-switch to global view
          state.scopeSummary = 'global';
          if (els.scopeSummaryChapter) els.scopeSummaryChapter.classList.remove('active');
          if (els.scopeSummaryGlobal) els.scopeSummaryGlobal.classList.add('active');
          renderAnalysis();
          alert('全書摘要整合完成！');
        }
      } catch (err) {
        console.error(err);
        alert('整合失敗：' + err.message);
      } finally {
        els.btnConsolidate.disabled = false;
        els.btnConsolidate.textContent = '🔮 整合全書摘要';
      }
    });
  }

  // Consolidate characters button
  if (els.btnConsolidateChars) {
    els.btnConsolidateChars.addEventListener('click', async () => {
      if (!state.currentNovel) { alert('請先選擇小說'); return; }
      if (!confirm('整合全書角色將讀取所有章節的提取記錄並進行深度去重與合併，這可能需要一點時間。確定要開始嗎？')) return;
      
      els.btnConsolidateChars.disabled = true;
      els.btnConsolidateChars.textContent = '整合中...';
      try {
        const res = await fetch(`${API_BASE}/novel/consolidate_chars/${encodeURIComponent(state.currentNovel.name)}`, {
          method: 'POST'
        });
        const data = await res.json();
        if (data.aggregate_characters && state.aiData) {
          state.aiData.aggregate_characters = data.aggregate_characters;
          // Also auto-switch to global view
          state.scopeChars = 'global';
          if (els.scopeCharsChapter) els.scopeCharsChapter.classList.remove('active');
          if (els.scopeCharsGlobal) els.scopeCharsGlobal.classList.add('active');
          renderAnalysis();
          alert('全書角色整合與深度整理完成！');
        } else {
          alert('整合完成，但角色列表為空。');
        }
      } catch (err) {
        console.error(err);
        alert('角色整合失敗：' + err.message);
      } finally {
        els.btnConsolidateChars.disabled = false;
        els.btnConsolidateChars.textContent = '👥 整合全書角色';
      }
    });
  }

  // Rebuild Timeline button
  if (els.btnRebuildTimeline) {
    els.btnRebuildTimeline.addEventListener('click', async () => {
      if (!state.currentNovel) { alert('請先選擇小說'); return; }
      
      els.btnRebuildTimeline.disabled = true;
      els.btnRebuildTimeline.textContent = '重建中...';
      try {
        const res = await fetch(`${API_BASE}/novel/rebuild_timeline/${encodeURIComponent(state.currentNovel.name)}`, {
          method: 'POST'
        });
        const data = await res.json();
        if (data.success && state.aiData) {
          state.aiData.timeline = data.timeline;
          state.aiData.aggregate_timeline = data.timeline;
          renderAnalysis();
          alert('時間軸已根據快取重建完成！');
        }
      } catch (err) {
        console.error(err);
        alert('重建失敗：' + err.message);
      } finally {
        els.btnRebuildTimeline.disabled = false;
        els.btnRebuildTimeline.textContent = '⏳ 重建時間軸';
      }
    });
  }
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

  // ── Summary (scope-aware) ──
  let summaryText = '';
  if (state.scopeSummary === 'chapter') {
    // Prefer explicit chapter_summary; fall back to extracting from full summary
    if (state.aiData.chapter_summary) {
      summaryText = state.aiData.chapter_summary;
    } else if (state.currentChapter && state.aiData.summary) {
      // Try to extract just this chapter's block from the aggregated summary
      const chName = state.currentChapter.name;
      const allSummary = state.aiData.summary || '';
      const regex = new RegExp(`###\\s+${chName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)(?=\n###\\s+|$)`);
      const match = allSummary.match(regex);
      summaryText = match ? match[1].trim() : '';
    }
  } else {
    // Global scope: prefer LLM-consolidated aggregate_summary, fall back to full summary
    summaryText = state.aiData.aggregate_summary || state.aiData.summary || '';
  }
  if (summaryText) {
    containerSummary.innerHTML = marked.parse(summaryText);
  } else {
    containerSummary.textContent = state.scopeSummary === 'chapter' ? '本章尚無摘要資料' : '無大綱資料';
  }

  // ── Characters (scope-aware) ──
  let charList = [];
  if (state.scopeChars === 'chapter') {
    charList = state.aiData.chars || [];
  } else {
    charList = state.aiData.aggregate_characters || state.aiData.characters || [];
  }

  containerChars.innerHTML = '';
  if (charList.length === 0) {
    containerChars.innerHTML = `<div class="empty-text">${state.scopeChars === 'chapter' ? '本章尚無角色資料' : '未偵測到角色'}</div>`;
  } else {
    charList.forEach(char => {
      const card = document.createElement('div');
      card.className = 'char-card';
      
      const name = escapeHTML(char['角色名稱'] || '未知');
      const aliasesRaw = char['別名'];
      const hasAliases = Array.isArray(aliasesRaw) ? aliasesRaw.length > 0 : !!aliasesRaw;
      const aliases = hasAliases 
        ? `<span class="char-aliases">(${escapeHTML(aliasesRaw)})</span>` 
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
  
  // ── Timeline (always global) ──
  const timeline = state.aiData.aggregate_timeline || state.aiData.timeline || [];
  const chapterTitles = state.aiData.chapter_titles || {};
  containerTimeline.innerHTML = '';
  if (timeline.length === 0) {
    containerTimeline.innerHTML = '<div class="empty-state">未偵測到事件</div>';
  } else {
    timeline.forEach(ev => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      const rolesRaw = ev['涉及角色'] || [];
      const roles = Array.isArray(rolesRaw) ? rolesRaw : [rolesRaw];
      
      const rawCh = ev['章節'] || '';
      const chDisplay = chapterTitles[rawCh] || rawCh;

      item.innerHTML = `
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-header">
            <span class="timeline-title">${escapeHTML(ev['事件名稱'] || '未知事件')}</span>
            <span class="timeline-chapter">${escapeHTML(chDisplay)}</span>
          </div>
          <div class="timeline-desc">${escapeHTML(ev['事件描述'] || '')}</div>
          <div class="timeline-tags">
            ${roles.map(c => `<span class="tag">${escapeHTML(c)}</span>`).join('')}
            <span class="tag" style="background:#fffcf0; border-color:#d4c4a8;">重要性: ${escapeHTML(ev['重要性'] || '中')}</span>
          </div>
        </div>
      `;
      containerTimeline.appendChild(item);
    });
  }
}

// ── Utils ──
function naturalSort(a, b) {
  const ax = [], bx = [];
  String(a || '').replace(/(\d+)|(\D+)/g, function(_, $1, $2) { ax.push([$1 || Infinity, $2 || ""]); });
  String(b || '').replace(/(\d+)|(\D+)/g, function(_, $1, $2) { bx.push([$1 || Infinity, $2 || ""]); });
  while (ax.length && bx.length) {
    const an = ax.shift();
    const bn = bx.shift();
    const nn = (an[0] - bn[0]) || an[1].localeCompare(bn[1]);
    if (nn) return nn;
  }
  return ax.length - bx.length;
}

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  if (Array.isArray(str)) str = str.join(', ');
  if (typeof str !== 'string') str = String(str);
  
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

    if (statusData.status === 'stopped') {
      console.log('偵測到背景任務已停止');
      finalizeGlobalBatch(batchState);
      clearInterval(timer);
      return;
    }

    if (statusData.status === 'done' || statusData.status === 'idle') {
      const currentCount = batchState.novelPlan[batchState.currentNovelIndex].count;
      if (batchState.completedChapters < batchState.totalChapters) {
        batchState.completedChapters = Math.min(batchState.totalChapters, batchState.completedChapters + currentCount);
      }
      
      batchState.currentNovelIndex += 1;
      
      if (batchState.currentNovelIndex >= batchState.novelPlan.length) {
        finalizeGlobalBatch(batchState);
        clearInterval(timer);
        return;
      }

      // Start the next novel in the plan
      const nextNovel = batchState.novelPlan[batchState.currentNovelIndex].name;
      batchState.currentNovel = nextNovel;
      saveGlobalBatchState(batchState);
      
      console.log(`正在啟動下一部小說: ${nextNovel}`);
      try {
        const tasks = [];
        if (document.getElementById('chk-mark').checked) tasks.push('mark');
        if (document.getElementById('chk-analyze').checked) tasks.push('chars', 'events', 'summary');
        
        await fetch(`${API_BASE}/batch/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            novel_id: nextNovel,
            use_cache: document.getElementById('chk-use-cache').checked,
            tasks: tasks.length > 0 ? tasks : ['mark']
          })
        });
      } catch (err) {
        console.error('Failed to start next novel in resume loop:', err);
      }

      renderGlobalBatchView(batchState, { current: 0, novelName: nextNovel });
      return;
    }

    if (statusData.status === 'not_found') {
      // If not found, it might be that the task hasn't started yet. 
      // In resume mode, we should try to start it.
      console.warn('任務狀態為 not_found，嘗試啟動:', novelName);
      try {
        const tasks = [];
        if (document.getElementById('chk-mark').checked) tasks.push('mark');
        if (document.getElementById('chk-analyze').checked) tasks.push('chars', 'events', 'summary');

        const res = await fetch(`${API_BASE}/batch/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            novel_id: novelName,
            use_cache: document.getElementById('chk-use-cache').checked,
            tasks: tasks.length > 0 ? tasks : ['mark']
          })
        });
        if (res.ok) {
          const data = await res.json();
          console.log(`成功啟動小說分析: ${novelName}, 總數: ${data.total}`);
        } else {
          console.error(`啟動分析失敗: ${res.statusText}`);
        }
      } catch (err) {
        console.error('Failed to (re)start novel in resume loop:', err);
      }
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

    // Delegate to the more robust timer-based resume logic
    await resumeGlobalBatchState(globalBatchState);

  } catch (err) {
    console.error('Failed to start global batch:', err);
    els.globalBatchLabel.textContent = '啟動失敗';
    clearGlobalBatchState();
    state.isGlobalBatching = false;
    els.btnGlobalBatch.disabled = false;
  }
});

els.btnGlobalStop?.addEventListener('click', async () => {
  if (confirm('確定要停止當前的全庫自動掃描嗎？這將中斷背景任務。')) {
    // Notify backend to stop ALL background tasks to be safe
    try {
      await fetch(`${API_BASE}/batch/stop/__ALL__`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to stop backend batch:', err);
    }
    
    state.isGlobalBatching = false;
    clearGlobalBatchState();
    location.reload(); // Hard reset to stop all frontend loops
  }
});

// Start app
init();
initScopeToggles();

// ── Right-Click Context Menu & Pane Toggle Logic ──
function initExtendedUI() {
  // 面板收合切換
  if (els.btnTogglePane) {
    els.btnTogglePane.addEventListener('click', () => {
      const pane = document.querySelector('.issue-pane');
      pane.classList.toggle('collapsed');
      
      // 如果面板收合了，建立一個浮動展開按鈕
      let expandBtn = document.getElementById('dynamic-expand-btn');
      if (pane.classList.contains('collapsed')) {
        if (!expandBtn) {
          expandBtn = document.createElement('button');
          expandBtn.id = 'dynamic-expand-btn';
          expandBtn.className = 'expand-btn';
          expandBtn.innerHTML = '◀';
          expandBtn.title = '展開面板';
          document.body.appendChild(expandBtn);
          expandBtn.addEventListener('click', () => {
            pane.classList.remove('collapsed');
            expandBtn.style.display = 'none';
          });
        }
        expandBtn.style.display = 'flex';
      } else {
        if (expandBtn) expandBtn.style.display = 'none';
      }
    });
  }

  // 點選其他地方關閉選單
  document.addEventListener('click', () => {
    if (els.contextMenu) els.contextMenu.style.display = 'none';
  });

  // 選單按鈕事件
  if (els.contextMenu) {
    els.contextMenu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        const issueId = els.contextMenu.dataset.issueId;
        const issue = state.issues.find(i => i.id == issueId);
        
        if (issue) {
          if (action === 'manual') {
            openModal(issue);
          } else {
            state.decisions[issue.id] = { action };
            updateAfterDecision();
          }
        }
        els.contextMenu.style.display = 'none';
      });
    });
  }
}

function showContextMenu(x, y, issue) {
  if (!els.contextMenu) return;
  
  const menu = els.contextMenu;
  menu.dataset.issueId = issue.id;
  
  // 更新選單資訊
  menu.querySelector('.menu-orig').textContent = issue.original;
  menu.querySelector('.menu-suggest').textContent = issue.suggestion;
  
  menu.style.display = 'flex';
  
  // 邊界檢查
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  
  let left = x;
  let top = y;
  
  if (x + menuWidth > windowWidth) left = x - menuWidth;
  if (y + menuHeight > windowHeight) top = y - menuHeight;
  
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

// 在最後呼叫擴充 UI 初始化
initExtendedUI();
