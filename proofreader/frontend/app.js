const API_BASE = 'http://localhost:7788/api';

// ── State ──
const state = {
  novels: [],
  chapters: [],
  currentNovel: null,
  currentChapter: null,
  originalText: '',
  issues: [],
  decisions: {}, // issue.id -> { action: 'accept'|'ignore'|'manual', manualText?: '' }
  aiData: null // { chars, events, summary, timeline }
};

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
  btnAcceptAll: document.getElementById('btn-accept-all'),
  
  // Modal
  modal: document.getElementById('modal-overlay'),
  modalInput: document.getElementById('modal-input'),
  modalCancel: document.getElementById('modal-cancel'),
  modalConfirm: document.getElementById('modal-confirm')
};

// ── Initialization ──
async function init() {
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
    const btn = document.createElement('button');
    btn.className = 'list-item';
    btn.textContent = novel.name;
    btn.onclick = () => selectNovel(novel, btn);
    els.novelList.appendChild(btn);
  });
}

async function selectNovel(novel, btnEl) {
  document.querySelectorAll('#novel-list .list-item').forEach(el => el.classList.remove('active'));
  btnEl.classList.add('active');
  
  state.currentNovel = novel;
  state.currentChapter = null;
  state.chapters = [];
  
  els.chapterList.innerHTML = '<div class="loading-text">載入中...</div>';
  els.chapterCount.textContent = '';
  resetWorkspace();
  
  try {
    const res = await fetch(`${API_BASE}/fs/chapters?novel_path=${encodeURIComponent(novel.path)}`);
    const data = await res.json();
    state.chapters = data.chapters;
    renderChapters();
  } catch (err) {
    console.error('Failed to load chapters:', err);
    els.chapterList.innerHTML = '<div class="error-text">無法載入章節清單</div>';
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
    btn.className = 'list-item';
    btn.textContent = chap.name;
    btn.onclick = () => selectChapter(chap, btn);
    els.chapterList.appendChild(btn);
  });
}

async function selectChapter(chap, btnEl) {
  document.querySelectorAll('#chapter-list .list-item').forEach(el => el.classList.remove('active'));
  btnEl.classList.add('active');
  
  state.currentChapter = chap;
  els.currentInfo.textContent = `${state.currentNovel.name} / ${chap.name}`;
  
  // Show workspace
  els.emptyState.style.display = 'none';
  els.actions.style.display = 'flex';
  els.tabs.style.display = 'flex';
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.getElementById('tab-proofread').style.display = 'block';
  
  els.editor.innerHTML = '載入中...';
  
  try {
    const res = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(chap.path)}`);
    const data = await res.json();
    state.originalText = data.content;
    state.issues = [];
    state.decisions = {};
    state.aiData = null;
    renderEditor();
    renderIssues();
  } catch (err) {
    console.error('Failed to load file content:', err);
    els.editor.innerHTML = '無法載入檔案內容';
  }
}

function resetWorkspace() {
  els.currentInfo.textContent = '請選擇章節';
  els.actions.style.display = 'none';
  els.tabs.style.display = 'none';
  els.emptyState.style.display = 'flex';
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
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
        tasks: tasks
      })
    });
    
    const data = await res.json();
    
    if (data.mark) {
      // Add unique IDs to issues
      state.issues = (data.mark.issues || []).map((issue, idx) => ({ ...issue, id: `i_${idx}` }));
      state.decisions = {};
    }
    
    if (runAnalyze) {
      state.aiData = {
        characters: data.chars || [],
        timeline: data.timeline || [],
        summary: data.summary || '',
        novel: state.currentNovel.name
      };
      console.log('角色與劇情分析完成');
    }
    
    renderEditor();
    renderIssues();
  } catch (err) {
    console.error(err);
    alert('分析失敗');
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
  if (!state.issues.length) {
    els.editor.textContent = state.originalText;
    return;
  }
  
  // Sort issues in reverse order to not mess up indices during insertion
  const sorted = [...state.issues].sort((a, b) => b.start - a.start);
  let html = escapeHTML(state.originalText);
  
  for (const issue of sorted) {
    const dec = state.decisions[issue.id];
    let actionClass = '';
    let displayStr = issue.original;
    
    if (dec) {
      actionClass = `hl-${dec.action}`;
      if (dec.action === 'accept') displayStr = issue.suggestion;
      else if (dec.action === 'manual') displayStr = dec.manualText;
    } else {
      actionClass = `hl-${issue.type}`;
    }
    
    const markHtml = `<mark class="hl ${actionClass}" data-id="${issue.id}" title="${issue.reason}">${escapeHTML(displayStr)}</mark>`;
    const origBytes = new TextEncoder().encode(state.originalText);
    
    // Note: Python string indices might be character-based, not byte-based.
    // The previous implementation used JS string slicing which matches Python's unicode char indices.
    const before = state.originalText.slice(0, issue.start);
    const after = state.originalText.slice(issue.end);
    
    // Rebuild text with markers
    // Since we are replacing backwards, we must use the original string slice indices,
    // but wait, html is being built by escaping... 
    // It's safer to build fragments.
  }
  
  // Better approach: build DOM nodes or fragments to avoid index shift with HTML entities.
  let currentIdx = 0;
  const fragments = [];
  const fSorted = [...state.issues].sort((a, b) => a.start - b.start);
  
  for (const issue of fSorted) {
    if (issue.start >= currentIdx) {
      fragments.push(escapeHTML(state.originalText.slice(currentIdx, issue.start)));
      
      const dec = state.decisions[issue.id];
      let actionClass = dec ? `hl-${dec.action}` : `hl-${issue.type}`;
      let displayStr = issue.original;
      if (dec?.action === 'accept') displayStr = issue.suggestion;
      if (dec?.action === 'manual') displayStr = dec.manualText;
      
      fragments.push(`<mark class="hl ${actionClass}" data-id="${issue.id}" title="${issue.reason}">${escapeHTML(displayStr)}</mark>`);
      currentIdx = issue.end;
    }
  }
  fragments.push(escapeHTML(state.originalText.slice(currentIdx)));
  els.editor.innerHTML = fragments.join('');
  
  // Bind clicks
  els.editor.querySelectorAll('mark.hl').forEach(mark => {
    mark.addEventListener('click', () => {
      const id = mark.dataset.id;
      const card = document.getElementById(`card-${id}`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.querySelectorAll('.issue-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
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
  
  filtered.forEach(issue => {
    const dec = state.decisions[issue.id];
    let cardClass = 'issue-card';
    if (dec) cardClass += ` i-${dec.action}`;
    
    const card = document.createElement('div');
    card.className = cardClass;
    card.id = `card-${issue.id}`;
    card.innerHTML = `
      <div class="issue-top">
        <span class="type-badge ${issue.type}">${issue.type}</span>
        <span class="issue-orig">${escapeHTML(issue.original)}</span>
        <span style="color:#aaa">➔</span>
        <span class="issue-suggest">${escapeHTML(issue.suggestion)}</span>
      </div>
      <div class="issue-reason">${escapeHTML(issue.reason)}</div>
      <div class="issue-actions">
        <button class="btn-acc" data-act="accept">接受</button>
        <button class="btn-ign" data-act="ignore">忽略</button>
        <button class="btn-man" data-act="manual">手動</button>
      </div>
    `;
    
    card.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDecision(issue, btn.dataset.act);
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
}

// ── Manual Edit Modal ──
let activeIssueForModal = null;

function openModal(issue) {
  activeIssueForModal = issue;
  els.modalInput.value = issue.original;
  els.modal.style.display = 'flex';
  els.modalInput.focus();
}

els.modalCancel.addEventListener('click', () => {
  els.modal.style.display = 'none';
  activeIssueForModal = null;
});

els.modalConfirm.addEventListener('click', () => {
  if (activeIssueForModal) {
    const val = els.modalInput.value.trim();
    if (val) {
      state.decisions[activeIssueForModal.id] = { action: 'manual', manualText: val };
      updateAfterDecision();
    }
  }
  els.modal.style.display = 'none';
  activeIssueForModal = null;
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
  els.batchList.innerHTML = '<div class="loading-text">正在讀取所有檔案內容...</div>';
  
  try {
    // Collect all files
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
    
    await fetch(`${API_BASE}/batch/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_id: state.currentNovel.name,
        files: filesData
      })
    });
    
    els.batchList.innerHTML = '<div class="loading-text">批次任務已啟動，請稍候...</div>';
    
    // Poll status
    const timer = setInterval(async () => {
      const res = await fetch(`${API_BASE}/batch/status/${encodeURIComponent(state.currentNovel.name)}`);
      const data = await res.json();
      
      if (data.status === 'processing') {
        els.batchList.innerHTML = `<div class="batch-item">
          <span>掃描進度</span>
          <strong>${data.current} / ${data.total}</strong>
        </div>`;
      } else if (data.status === 'done') {
        clearInterval(timer);
        els.batchList.innerHTML = `<div class="batch-item">
          <span style="color:#2e7d32; font-weight:bold;">批次掃描完成！</span>
          <strong>${data.total} / ${data.total}</strong>
        </div>`;
        els.btnBatchStart.disabled = false;
      }
    }, 2000);
    
  } catch (err) {
    console.error(err);
    alert('啟動批次任務失敗');
    els.btnBatchStart.disabled = false;
  }
});

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

// Start app
init();
