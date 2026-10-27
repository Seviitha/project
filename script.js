/* TaskFlow – vanilla JS. The `state.tasks` array is the single source of truth:
   data functions mutate it and save; render functions only read it. */
(() => {
  'use strict';

  const KEYS = { tasks: 'taskflow.tasks.v1', theme: 'taskflow.theme' };
  const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };
  const VIEW_TITLES = {
    dashboard: 'Dashboard · needs attention', all: 'All tasks', today: 'Today',
    upcoming: 'Upcoming', active: 'Active tasks', completed: 'Completed tasks', overdue: 'Overdue'
  };
  const ICONS = {
    edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>'
  };

  const state = { tasks: [], view: 'dashboard', query: '', priority: 'all', category: 'all', sort: 'created' };
  const $ = (id) => document.getElementById(id);

  /* ---------- Helpers ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  /** Local date as YYYY-MM-DD. Due dates use the same format, so plain string comparison is safe. */
  const dateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => dateStr();
  const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return dateStr(d); };
  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const isOverdue = (t) => !t.completed && !!t.due && t.due < todayStr();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text; // textContent: user text is never parsed as HTML
    return node;
  }

  function formatDue(due) {
    if (due === todayStr()) return 'Today';
    if (due === tomorrowStr()) return 'Tomorrow';
    return new Date(`${due}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* ---------- Storage ---------- */
  function storage() { try { return window.localStorage; } catch { return null; } }

  /** Validates one stored record; returns null for unusable data. */
  function sanitizeTask(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string' || !raw.title.trim()) return null;
    return {
      id: String(raw.id || uid()),
      title: raw.title.trim().slice(0, 120),
      description: typeof raw.description === 'string' ? raw.description.slice(0, 500) : '',
      priority: raw.priority in PRIORITY_RANK ? raw.priority : 'medium',
      category: typeof raw.category === 'string' ? raw.category.trim().slice(0, 30) : '',
      due: /^\d{4}-\d{2}-\d{2}$/.test(raw.due) ? raw.due : '',
      completed: Boolean(raw.completed),
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      demo: Boolean(raw.demo)
    };
  }

  function demoTasks() {
    const now = Date.now();
    const mk = (i, title, description, priority, category, due) =>
      ({ id: uid(), title, description, priority, category, due, completed: false, createdAt: now - i * 1000, demo: true });
    return [
      mk(0, 'Finish JavaScript assignment', 'Build and test the TaskFlow project.', 'high', 'Study', todayStr()),
      mk(1, 'Revise array methods', 'filter, map, find and reduce.', 'medium', 'Study', tomorrowStr()),
      mk(2, 'Submit lab record', 'Was due yesterday.', 'high', 'College', (() => { const d = new Date(); d.setDate(d.getDate() - 1); return dateStr(d); })()),
      mk(3, 'Go for a walk', '', 'low', 'Personal', '')
    ];
  }

  function loadTasks() {
    const store = storage();
    let raw = null;
    try { raw = store && store.getItem(KEYS.tasks); } catch { /* inaccessible */ }
    if (raw === null || raw === undefined) return demoTasks(); // first visit only
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) throw new Error('not an array');
      return data.map(sanitizeTask).filter(Boolean);
    } catch {
      try { store.setItem(`${KEYS.tasks}.backup`, raw); } catch { /* ignore */ }
      showToast('Saved data was unreadable. A backup copy was kept.', 'error');
      return [];
    }
  }

  function saveTasks() {
    try { storage().setItem(KEYS.tasks, JSON.stringify(state.tasks)); return true; }
    catch { showToast('Could not save. Browser storage is unavailable or full.', 'error'); return false; }
  }

  /* ---------- State mutations (data only, no DOM) ---------- */
  function addTask(fields) {
    state.tasks.unshift({ id: uid(), ...fields, completed: false, createdAt: Date.now(), demo: false });
    saveTasks();
  }
  function updateTask(id, fields) {
    state.tasks = state.tasks.map((t) => (t.id === id ? { ...t, ...fields, id: t.id } : t));
    saveTasks();
  }
  function deleteTask(id) { state.tasks = state.tasks.filter((t) => t.id !== id); saveTasks(); }
  function toggleTaskStatus(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (t) updateTask(id, { completed: !t.completed });
  }
  function clearCompleted() { state.tasks = state.tasks.filter((t) => !t.completed); saveTasks(); }
  function removeDemoTasks() { state.tasks = state.tasks.filter((t) => !t.demo); saveTasks(); }

  /* ---------- Derived data (pure; never touches state.tasks) ---------- */
  function filterTasks(tasks) {
    const today = todayStr();
    const byView = {
      dashboard: (t) => !t.completed && (t.due === today || isOverdue(t) || t.priority === 'high'),
      all: () => true,
      today: (t) => t.due === today,
      upcoming: (t) => !t.completed && !!t.due && t.due > today,
      active: (t) => !t.completed,
      completed: (t) => t.completed,
      overdue: isOverdue
    }[state.view];
    return tasks.filter((t) => byView(t)
      && (state.priority === 'all' || t.priority === state.priority)
      && (state.category === 'all' || t.category === state.category));
  }

  function searchTasks(tasks) {
    const q = state.query.trim().toLowerCase();
    return q ? tasks.filter((t) => `${t.title} ${t.description}`.toLowerCase().includes(q)) : tasks;
  }

  function sortTasks(tasks) {
    const sorters = {
      created: (a, b) => b.createdAt - a.createdAt,
      due: (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.createdAt - a.createdAt,
      priority: (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.createdAt - a.createdAt,
      alpha: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    };
    return [...tasks].sort(sorters[state.sort]); // copy, so the source array keeps its order
  }

  const visibleTasks = () => sortTasks(searchTasks(filterTasks(state.tasks)));
  const categories = () => [...new Set(state.tasks.map((t) => t.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  /* ---------- Rendering (reads state only) ---------- */
  function taskCard(t) {
    const li = el('li', `task p-${t.priority}${t.completed ? ' done' : ''}${isOverdue(t) ? ' overdue' : ''}`);
    li.dataset.id = t.id;

    const check = el('input', 'check');
    check.type = 'checkbox';
    check.checked = t.completed;
    check.dataset.action = 'toggle';
    check.setAttribute('aria-label', `Mark "${t.title}" as ${t.completed ? 'active' : 'completed'}`);

    const body = el('div');
    body.append(el('div', 't-title', t.title));
    if (t.description) body.append(el('div', 't-desc', t.description));
    const meta = el('div', 'meta');
    meta.append(el('span', `badge ${t.priority}`, t.priority[0].toUpperCase() + t.priority.slice(1)));
    if (t.category) meta.append(el('span', 'badge', t.category));
    if (t.due) meta.append(el('span', 'badge', `Due ${formatDue(t.due)}`));
    if (isOverdue(t)) meta.append(el('span', 'badge late', 'Overdue'));
    body.append(meta);

    const actions = el('div', 'row-actions');
    [['edit', 'Edit'], ['delete', 'Delete']].forEach(([action, label]) => {
      const b = el('button', 'icon-btn');
      b.type = 'button';
      b.dataset.action = action;
      b.setAttribute('aria-label', `${label} "${t.title}"`);
      b.innerHTML = ICONS[action === 'edit' ? 'edit' : 'trash']; // static, trusted SVG only
      actions.append(b);
    });

    li.append(check, body, actions);
    return li;
  }

  function renderTasks() {
    const items = visibleTasks();
    $('taskList').replaceChildren(...items.map(taskCard));
    $('viewTitle').textContent = VIEW_TITLES[state.view];
    $('resultCount').textContent = `${items.length} ${items.length === 1 ? 'task' : 'tasks'} shown`;

    const empty = $('empty');
    empty.hidden = items.length > 0;
    if (!items.length) {
      const none = state.tasks.length === 0;
      $('emptyTitle').textContent = none ? 'No tasks yet' : 'Nothing matches';
      $('emptyText').textContent = none ? 'Add your first task to get started.' : 'Try another view, or clear the filters and search.';
      $('emptyAdd').hidden = !none;
    }
  }

  function updateStatistics() {
    const total = state.tasks.length;
    const done = state.tasks.filter((t) => t.completed).length;
    $('statTotal').textContent = total;
    $('statActive').textContent = total - done;
    $('statDone').textContent = done;
    $('statOverdue').textContent = state.tasks.filter(isOverdue).length;
    $('clearCompleted').disabled = done === 0;
    $('demoBtn').hidden = !state.tasks.some((t) => t.demo);
    renderProgress(total ? Math.round((done / total) * 100) : 0); // no division by zero
  }

  function renderProgress(pct) {
    $('pct').textContent = `${pct}%`;
    $('barFill').style.width = `${pct}%`;
    $('bar').setAttribute('aria-valuenow', pct);
  }

  function renderNav() {
    document.querySelectorAll('#nav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === state.view)));
  }

  function renderCategories() {
    const cats = categories();
    if (state.category !== 'all' && !cats.includes(state.category)) state.category = 'all';

    const nav = $('catNav');
    nav.replaceChildren();
    if (!cats.length) nav.append(el('p', 't-desc', 'Categories you add will appear here.'));
    cats.forEach((c) => {
      const b = el('button');
      b.dataset.category = c;
      b.setAttribute('aria-current', String(c === state.category));
      b.append(el('span', '', c), el('small', '', state.tasks.filter((t) => t.category === c).length));
      nav.append(b);
    });

    const select = $('filterCategory');
    select.replaceChildren(new Option('All', 'all'), ...cats.map((c) => new Option(c, c)));
    select.value = state.category;
    $('catList').replaceChildren(...cats.map((c) => new Option(c)));
  }

  function render() {
    renderCategories();
    renderNav();
    updateStatistics();
    renderTasks();
  }

  /* ---------- Toasts, confirm dialog, theme ---------- */
  function showToast(message, type = 'success') {
    const toast = el('div', `toast ${type === 'error' ? 'error' : ''}`, message);
    $('toasts').append(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function confirmAction(title, message, okLabel) {
    return new Promise((resolve) => {
      const dlg = $('confirmDialog');
      $('confirmTitle').textContent = title;
      $('confirmMsg').textContent = message;
      $('confirmOk').textContent = okLabel;
      dlg.returnValue = 'cancel';
      dlg.onclose = () => resolve(dlg.returnValue === 'ok'); // assigned, not added: no duplicate listeners
      dlg.showModal();
    });
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('themeLabel').textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
  }
  function loadTheme() {
    try { const t = storage().getItem(KEYS.theme); return t === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { storage().setItem(KEYS.theme, next); } catch { /* preference just won't persist */ }
  }

  /* ---------- Task form ---------- */
  function openForm(task) {
    $('taskForm').reset();
    $('titleError').textContent = '';
    $('tTitle').removeAttribute('aria-invalid');
    $('dialogTitle').textContent = task ? 'Edit task' : 'New task';
    $('saveBtn').textContent = task ? 'Save changes' : 'Add task';
    $('tId').value = task ? task.id : '';
    if (task) {
      $('tTitle').value = task.title;
      $('tDesc').value = task.description;
      $('tPriority').value = task.priority;
      $('tCategory').value = task.category;
      $('tDue').value = task.due;
    }
    $('taskDialog').showModal();
    $('tTitle').focus();
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    const title = $('tTitle').value.trim(); // rejects empty and whitespace-only titles
    if (!title) {
      $('titleError').textContent = 'Enter a task title.';
      $('tTitle').setAttribute('aria-invalid', 'true');
      $('tTitle').focus();
      return;
    }
    const fields = {
      title,
      description: $('tDesc').value.trim(),
      priority: $('tPriority').value,
      category: $('tCategory').value.trim(),
      due: $('tDue').value
    };
    const id = $('tId').value;
    if (id) { updateTask(id, fields); showToast('Task updated'); }
    else { addTask(fields); showToast('Task added'); }
    $('taskDialog').close();
    render();
  }

  /* ---------- Events ---------- */
  function setView(view) { state.view = view; document.body.classList.remove('menu-open'); render(); }

  function syncControls() {
    $('search').value = state.query;
    $('filterPriority').value = state.priority;
    $('filterCategory').value = state.category;
    $('sortBy').value = state.sort;
  }

  async function handleListClick(event) {
    const btn = event.target.closest('[data-action]');
    const li = event.target.closest('li[data-id]');
    if (!btn || !li || btn.dataset.action === 'toggle') return; // checkbox handled on "change"
    const task = state.tasks.find((t) => t.id === li.dataset.id);
    if (!task) return;
    if (btn.dataset.action === 'edit') openForm(task);
    if (btn.dataset.action === 'delete') {
      if (await confirmAction('Delete this task?', `"${task.title}" will be removed permanently.`, 'Delete')) {
        deleteTask(task.id); render(); showToast('Task deleted');
      }
    }
  }

  function bindEvents() {
    // One delegated listener pair serves every task card, including ones added later.
    $('taskList').addEventListener('click', handleListClick);
    $('taskList').addEventListener('change', (e) => {
      const li = e.target.closest('li[data-id]');
      if (e.target.dataset.action === 'toggle' && li) { toggleTaskStatus(li.dataset.id); render(); }
    });

    $('nav').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
    $('catNav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-category]');
      if (!b) return;
      state.category = state.category === b.dataset.category ? 'all' : b.dataset.category; // click again to unselect
      if (state.view === 'dashboard') state.view = 'all';
      document.body.classList.remove('menu-open');
      render();
    });

    $('search').addEventListener('input', (e) => { state.query = e.target.value; renderTasks(); });
    $('filterPriority').addEventListener('change', (e) => { state.priority = e.target.value; renderTasks(); });
    $('filterCategory').addEventListener('change', (e) => { state.category = e.target.value; renderCategories(); renderTasks(); });
    $('sortBy').addEventListener('change', (e) => { state.sort = e.target.value; renderTasks(); });
    $('clearFilters').addEventListener('click', () => {
      Object.assign(state, { query: '', priority: 'all', category: 'all', sort: 'created' });
      syncControls(); render();
    });

    $('addBtn').addEventListener('click', () => openForm());
    $('emptyAdd').addEventListener('click', () => openForm());
    $('taskForm').addEventListener('submit', handleFormSubmit);
    $('cancelBtn').addEventListener('click', () => $('taskDialog').close());

    $('clearCompleted').addEventListener('click', async () => {
      const n = state.tasks.filter((t) => t.completed).length;
      if (n && await confirmAction('Clear completed tasks?', `${n} completed ${n === 1 ? 'task' : 'tasks'} will be removed permanently.`, 'Clear')) {
        clearCompleted(); render(); showToast('Completed tasks cleared');
      }
    });
    $('demoBtn').addEventListener('click', async () => {
      if (await confirmAction('Remove demo tasks?', 'Only the sample tasks are removed. Your own tasks stay.', 'Remove')) {
        removeDemoTasks(); render(); showToast('Demo tasks removed');
      }
    });

    $('themeBtn').addEventListener('click', toggleTheme);
    $('menuBtn').addEventListener('click', () => document.body.classList.add('menu-open'));
    $('scrim').addEventListener('click', () => document.body.classList.remove('menu-open'));

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
      if (e.key === '/') { e.preventDefault(); $('search').focus(); }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); openForm(); }
    });
  }

  /* ---------- Init ---------- */
  function init() {
    applyTheme(loadTheme());
    state.tasks = loadTasks();
    if (storage() && storage().getItem(KEYS.tasks) === null) saveTasks(); // persist demo set once, so deleting it sticks
    const h = new Date().getHours();
    $('greeting').textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    $('today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    bindEvents();
    render();
  }

  init();
})();