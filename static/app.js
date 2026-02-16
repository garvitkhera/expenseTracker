// ─── State ───
const state = {
  token: localStorage.getItem("token") || null,
  userId: localStorage.getItem("userId") || null,
  displayName: localStorage.getItem("displayName") || "",
  currentPage: "home",
  sidebarOpen: false,
  categories: [],
  parties: [],
  expenses: [],
  ledger: [],
  dashboard: null,
  // Voice
  isRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  parsedData: null,
  // Modal
  modalType: null, // 'confirm', 'edit', 'addParty', 'addCategory'
  editData: null,
  // Filters
  filters: { dateFrom: "", dateTo: "", partyId: "", categoryId: "" },
  // Reports
  reportUrl: null,
  reportFilename: null,
};

const API = "";

// ─── Helpers ───
function $(sel) { return document.querySelector(sel); }
function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  return fetch(`${API}${path}`, { ...opts, headers }).then(async r => {
    if (r.status === 401) { logout(); throw new Error("Unauthorized"); }
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  });
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00+05:30");
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtAmount(n) {
  return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function todayIST() {
  const now = new Date(Date.now() + (5.5 * 60 * 60 * 1000 - new Date().getTimezoneOffset() * 60000));
  return now.toISOString().slice(0, 10);
}

function fyStart() {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-04-01`;
}

function weekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function lastMonthRange() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  return [start, end];
}

const ENTRY_TYPES = {
  goods_sold: () => t("type_goods_sold"),
  payment_received: () => t("type_payment_received"),
  payment_made: () => t("type_payment_made"),
  goods_returned: () => t("type_goods_returned"),
  goods_taken: () => t("type_goods_taken"),
};

// ─── Auth ───
function logout() {
  state.token = null;
  state.userId = null;
  localStorage.removeItem("token");
  localStorage.removeItem("userId");
  localStorage.removeItem("displayName");
  render();
}

async function handleLogin(e) {
  e.preventDefault();
  const username = $("#login-user").value.trim();
  const password = $("#login-pass").value;
  try {
    const res = await fetch(`${API}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error("fail");
    const data = await res.json();
    state.token = data.token;
    state.userId = data.user_id;
    state.displayName = data.display_name;
    localStorage.setItem("token", data.token);
    localStorage.setItem("userId", data.user_id);
    localStorage.setItem("displayName", data.display_name);
    render();
  } catch {
    $(".login-error").style.display = "block";
  }
}

// ─── Data Loading ───
async function loadCategories() {
  state.categories = await api("/api/categories");
}

async function loadParties() {
  state.parties = await api("/api/parties");
}

async function loadDashboard() {
  state.dashboard = await api("/api/dashboard");
}

async function loadExpenses() {
  const p = new URLSearchParams();
  if (state.filters.dateFrom) p.set("date_from", state.filters.dateFrom);
  if (state.filters.dateTo) p.set("date_to", state.filters.dateTo);
  if (state.filters.categoryId) p.set("category_id", state.filters.categoryId);
  state.expenses = await api(`/api/expenses?${p}`);
}

async function loadLedger() {
  const p = new URLSearchParams();
  if (state.filters.partyId) p.set("party_id", state.filters.partyId);
  if (state.filters.dateFrom) p.set("date_from", state.filters.dateFrom);
  if (state.filters.dateTo) p.set("date_to", state.filters.dateTo);
  state.ledger = await api(`/api/ledger?${p}`);
}

// ─── Voice Recording ───
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    mr.ondataavailable = (e) => { if (e.data.size > 0) state.audioChunks.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(state.audioChunks, { type: "audio/webm" });
      await processAudio(blob);
    };
    mr.start();
    state.mediaRecorder = mr;
    state.isRecording = true;
    updateVoiceUI();
  } catch (err) {
    toast(t("error") + ": Microphone access denied");
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop();
    state.isRecording = false;
    updateVoiceUI();
  }
}

function updateVoiceUI() {
  const fab = $(".voice-fab");
  const label = $(".voice-label");
  if (!fab) return;
  if (state.isRecording) {
    fab.classList.add("recording");
    fab.innerHTML = "⏹";
    label.textContent = t("voice_recording");
    label.classList.add("visible");
  } else {
    fab.classList.remove("recording");
    fab.innerHTML = "🎙";
    label.textContent = t("voice_hold");
    label.classList.remove("visible");
  }
}

async function processAudio(blob) {
  // Show processing state
  const label = $(".voice-label");
  if (label) { label.textContent = t("voice_processing"); label.classList.add("visible"); }

  const fd = new FormData();
  fd.append("audio", blob, "recording.webm");
  try {
    const parsed = await api("/api/voice/process", { method: "POST", body: fd });
    state.parsedData = parsed;
    showConfirmation(parsed);
  } catch (err) {
    toast(t("error"));
  } finally {
    if (label) label.classList.remove("visible");
  }
}

// ─── Confirmation Flow ───
function showConfirmation(parsed) {
  // Check if party needs to be added first
  if (parsed.type === "ledger" && parsed.party_name && !parsed.party_match_found) {
    state.modalType = "addPartyFirst";
    state.parsedData = parsed;
    render();
    return;
  }
  // Check if category needs to be added first
  if (parsed.type === "expense" && parsed.category && !parsed.category_match_found) {
    state.modalType = "addCategoryFirst";
    state.parsedData = parsed;
    render();
    return;
  }

  state.modalType = "confirm";
  state.parsedData = parsed;
  render();
}

async function acceptEntry() {
  const p = state.parsedData;
  if (!p) return;

  try {
    if (p.type === "expense") {
      // Find category ID
      const cat = state.categories.find(c => c.name.toLowerCase() === (p.category || "").toLowerCase());
      if (!cat) { toast(t("confirm_add_category_first")); return; }

      const dateOffset = p.date_offset_days || 0;
      const d = new Date();
      d.setDate(d.getDate() + dateOffset);
      const dateStr = d.toISOString().slice(0, 10);

      await api("/api/expenses", {
        method: "POST",
        body: {
          category_id: cat.id,
          amount: p.amount,
          description: p.description || p.raw_text || "",
          raw_voice_text: p.raw_text || "",
          date: dateStr,
        },
      });
    } else if (p.type === "ledger") {
      const party = state.parties.find(pt =>
        pt.name.toLowerCase() === (p.party_name || "").toLowerCase()
      );
      if (!party) { toast(t("confirm_add_party_first")); return; }

      const dateOffset = p.date_offset_days || 0;
      const d = new Date();
      d.setDate(d.getDate() + dateOffset);
      const dateStr = d.toISOString().slice(0, 10);

      await api("/api/ledger", {
        method: "POST",
        body: {
          party_id: party.id,
          entry_type: p.entry_type || "goods_sold",
          item_name: p.item_name || "",
          quantity: p.quantity || null,
          unit: p.unit || "",
          rate: p.rate || null,
          amount: p.amount,
          description: p.description || "",
          raw_voice_text: p.raw_text || "",
          date: dateStr,
        },
      });
    }

    toast(t("confirm_saved"));
    state.modalType = null;
    state.parsedData = null;
    // Reload current page data
    if (state.currentPage === "home") await loadDashboard();
    else if (state.currentPage === "expenses") await loadExpenses();
    else if (state.currentPage === "ledger") await loadLedger();
    render();
  } catch (err) {
    toast(t("error") + ": " + err.message);
  }
}

function rejectEntry() {
  toast(t("confirm_cancelled"));
  state.modalType = null;
  state.parsedData = null;
  render();
}

function editEntry() {
  state.modalType = "edit";
  // Prepare edit data from parsed
  const p = state.parsedData;
  const dateOffset = p.date_offset_days || 0;
  const d = new Date();
  d.setDate(d.getDate() + dateOffset);

  state.editData = {
    type: p.type || "expense",
    category: p.category || "",
    party_name: p.party_name || "",
    entry_type: p.entry_type || "goods_sold",
    item_name: p.item_name || "",
    quantity: p.quantity || "",
    unit: p.unit || "",
    rate: p.rate || "",
    amount: p.amount || "",
    description: p.description || "",
    date: d.toISOString().slice(0, 10),
    raw_voice_text: p.raw_text || "",
  };
  render();
}

async function saveEditedEntry() {
  const e = state.editData;
  try {
    if (e.type === "expense") {
      const cat = state.categories.find(c => c.name.toLowerCase() === e.category.toLowerCase())
        || state.categories.find(c => c.id === e.category);
      if (!cat) { toast(t("confirm_add_category_first")); return; }
      await api("/api/expenses", {
        method: "POST",
        body: {
          category_id: cat.id,
          amount: parseFloat(e.amount),
          description: e.description,
          raw_voice_text: e.raw_voice_text,
          date: e.date,
        },
      });
    } else if (e.type === "ledger") {
      const party = state.parties.find(pt => pt.name.toLowerCase() === e.party_name.toLowerCase())
        || state.parties.find(pt => pt.id === e.party_name);
      if (!party) { toast(t("confirm_add_party_first")); return; }
      await api("/api/ledger", {
        method: "POST",
        body: {
          party_id: party.id,
          entry_type: e.entry_type,
          item_name: e.item_name,
          quantity: e.quantity ? parseFloat(e.quantity) : null,
          unit: e.unit,
          rate: e.rate ? parseFloat(e.rate) : null,
          amount: parseFloat(e.amount),
          description: e.description,
          raw_voice_text: e.raw_voice_text,
          date: e.date,
        },
      });
    }
    toast(t("confirm_saved"));
    state.modalType = null;
    state.parsedData = null;
    state.editData = null;
    if (state.currentPage === "home") await loadDashboard();
    else if (state.currentPage === "expenses") await loadExpenses();
    else if (state.currentPage === "ledger") await loadLedger();
    render();
  } catch (err) {
    toast(t("error") + ": " + err.message);
  }
}

async function quickAddParty(name) {
  await api("/api/parties", { method: "POST", body: { name: name.trim() } });
  await loadParties();
  toast(t("success") + " " + name);
  // Now re-show confirm
  if (state.parsedData) {
    state.parsedData.party_match_found = true;
    state.modalType = "confirm";
    render();
  }
}

async function quickAddCategory(name) {
  await api("/api/categories", { method: "POST", body: { name: name.trim() } });
  await loadCategories();
  toast(t("success") + " " + name);
  if (state.parsedData) {
    state.parsedData.category_match_found = true;
    state.modalType = "confirm";
    render();
  }
}

// ─── Delete Entries ───
async function deleteExpense(id) {
  if (!confirm(t("delete") + "?")) return;
  await api(`/api/expenses/${id}`, { method: "DELETE" });
  await loadExpenses();
  toast(t("success"));
  render();
}

async function deleteLedgerEntry(id) {
  if (!confirm(t("delete") + "?")) return;
  await api(`/api/ledger/${id}`, { method: "DELETE" });
  await loadLedger();
  toast(t("success"));
  render();
}

// ─── Render ───
function render() {
  const root = $("#app");
  if (!state.token) {
    root.innerHTML = renderLogin();
    attachLoginEvents();
    return;
  }
  root.innerHTML = renderApp();
  attachAppEvents();
}

function renderLogin() {
  return `
    <div class="login-screen">
      <div class="login-box">
        <span class="logo-icon">📒</span>
        <h1>${t("login_title")}</h1>
        <p>${t("login_subtitle")}</p>
        <form id="login-form">
          <div class="form-group">
            <label>${t("username")}</label>
            <input id="login-user" class="form-input" type="text" autocomplete="username" required>
          </div>
          <div class="form-group">
            <label>${t("password")}</label>
            <input id="login-pass" class="form-input" type="password" autocomplete="current-password" required>
          </div>
          <button type="submit" class="btn btn-primary">${t("login_btn")}</button>
          <p class="login-error">${t("login_error")}</p>
        </form>
      </div>
      <div style="margin-top:16px">
        <button class="lang-toggle" onclick="toggleLang(); render();">${t("language_toggle")}</button>
      </div>
    </div>
  `;
}

function renderApp() {
  return `
    <div class="app-container">
      <div class="sidebar-backdrop ${state.sidebarOpen ? "show" : ""}" id="sidebar-backdrop"></div>
      <aside class="sidebar ${state.sidebarOpen ? "open" : ""}" id="sidebar">
        <div class="sidebar-header">
          <h2>📒 ${t("app_name")}</h2>
          <div class="user-name">${state.displayName}</div>
        </div>
        <nav class="sidebar-nav">
          <div class="sidebar-section-label">Menu</div>
          ${navItem("home", "🏠", t("nav_home"))}
          ${navItem("expenses", "💰", t("nav_expenses"))}
          ${navItem("ledger", "📖", t("nav_ledger"))}
          ${navItem("parties", "👥", t("nav_parties"))}
          ${navItem("categories", "🏷", t("nav_categories"))}
          ${navItem("reports", "📊", t("nav_reports"))}
        </nav>
        <div class="sidebar-footer">
          <div class="nav-item" onclick="logout()">
            <span class="nav-icon">🚪</span> ${t("logout")}
          </div>
        </div>
      </aside>
      <main class="main-content">
        <div class="topbar">
          <div class="topbar-left">
            <button class="menu-toggle" id="menu-toggle">☰</button>
            <span class="topbar-title">${getPageTitle()}</span>
          </div>
          <div class="topbar-right">
            <button class="lang-toggle" onclick="toggleLang();">${t("language_toggle")}</button>
          </div>
        </div>
        <div class="page-content" id="page-content">
          ${renderPage()}
        </div>
        <button class="voice-fab" id="voice-fab">🎙</button>
        <div class="voice-label" id="voice-label">${t("voice_hold")}</div>
      </main>
    </div>
    ${renderModal()}
  `;
}

function navItem(page, icon, label) {
  return `<div class="nav-item ${state.currentPage === page ? "active" : ""}" data-page="${page}">
    <span class="nav-icon">${icon}</span> ${label}
  </div>`;
}

function getPageTitle() {
  const map = {
    home: () => t("nav_home"),
    expenses: () => t("nav_expenses"),
    ledger: () => t("nav_ledger"),
    parties: () => t("nav_parties"),
    categories: () => t("nav_categories"),
    reports: () => t("nav_reports"),
  };
  return (map[state.currentPage] || map.home)();
}

// ─── Pages ───
function renderPage() {
  const pages = { home: renderHome, expenses: renderExpenses, ledger: renderLedger, parties: renderParties, categories: renderCategories, reports: renderReports };
  return (pages[state.currentPage] || renderHome)();
}

function renderHome() {
  const d = state.dashboard;
  if (!d) return `<div class="spinner"></div>`;
  return `
    <div class="stats-grid">
      <div class="card">
        <div class="card-title">${t("dash_today")}</div>
        <div class="card-value green">${fmtAmount(d.today_total)}</div>
      </div>
      <div class="card">
        <div class="card-title">${t("dash_this_month")}</div>
        <div class="card-value amber">${fmtAmount(d.month_total)}</div>
      </div>
      <div class="card">
        <div class="card-title">${t("dash_this_fy")}</div>
        <div class="card-value">${fmtAmount(d.fy_total)}</div>
      </div>
      <div class="card">
        <div class="card-title">${t("dash_clients")}</div>
        <div class="card-value">${d.party_count}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">${t("dash_recent")}</div>
      ${d.recent_expenses.length === 0 ? `<div class="empty-state"><p>${t("dash_no_entries")}</p></div>` :
        d.recent_expenses.map(e => `
          <div class="entry-item">
            <div class="entry-left">
              <div class="entry-title">${e.category_name || e.description}</div>
              <div class="entry-sub">${fmtDate(e.date)}${e.description ? " · " + e.description : ""}</div>
            </div>
            <div class="entry-amount debit">${fmtAmount(e.amount)}</div>
          </div>
        `).join("")
      }
    </div>
  `;
}

function renderExpenses() {
  return `
    <div class="filter-bar">
      <div class="filter-group">
        <label>${t("reports_date_from")}</label>
        <input type="date" class="filter-input" id="f-date-from" value="${state.filters.dateFrom}">
      </div>
      <div class="filter-group">
        <label>${t("reports_date_to")}</label>
        <input type="date" class="filter-input" id="f-date-to" value="${state.filters.dateTo}">
      </div>
      <div class="filter-group">
        <label>${t("confirm_category")}</label>
        <select class="filter-select" id="f-category">
          <option value="">All</option>
          ${state.categories.map(c => `<option value="${c.id}" ${state.filters.categoryId === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
        </select>
      </div>
      <button class="btn btn-primary btn-sm" id="filter-apply">🔍</button>
    </div>
    <div class="card">
      ${state.expenses.length === 0 ? `<div class="empty-state"><div class="empty-icon">💰</div><p>${t("exp_no_data")}</p></div>` :
        state.expenses.map(e => `
          <div class="entry-item">
            <div class="entry-left">
              <div class="entry-title">${e.category_name}</div>
              <div class="entry-sub">${fmtDate(e.date)}${e.description ? " · " + e.description : ""}</div>
            </div>
            <div class="entry-amount debit">${fmtAmount(e.amount)}</div>
            <div class="entry-actions">
              <button onclick="deleteExpense('${e.id}')" title="${t("delete")}">🗑</button>
            </div>
          </div>
        `).join("")
      }
    </div>
  `;
}

function renderLedger() {
  // Calculate totals
  let payable = 0, receivable = 0;
  state.ledger.forEach(e => {
    const amt = parseFloat(e.amount);
    if (e.entry_type === "goods_sold") payable += amt;
    else if (e.entry_type === "payment_received") payable -= amt;
    else if (e.entry_type === "payment_made") receivable += amt;
    else if (e.entry_type === "goods_returned") payable -= amt;
    else if (e.entry_type === "goods_taken") receivable -= amt;
  });

  return `
    <div class="filter-bar">
      <div class="filter-group">
        <label>${t("ledger_select_party")}</label>
        <select class="filter-select" id="f-party">
          <option value="">${t("ledger_all")}</option>
          ${state.parties.map(p => `<option value="${p.id}" ${state.filters.partyId === p.id ? "selected" : ""}>${p.name}</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">
        <label>${t("reports_date_from")}</label>
        <input type="date" class="filter-input" id="f-date-from" value="${state.filters.dateFrom}">
      </div>
      <div class="filter-group">
        <label>${t("reports_date_to")}</label>
        <input type="date" class="filter-input" id="f-date-to" value="${state.filters.dateTo}">
      </div>
      <button class="btn btn-primary btn-sm" id="filter-apply">🔍</button>
    </div>
    ${state.filters.partyId ? `
    <div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="card"><div class="card-title">${t("ledger_payable")}</div><div class="card-value red">${fmtAmount(payable)}</div></div>
      <div class="card"><div class="card-title">${t("ledger_receivable")}</div><div class="card-value amber">${fmtAmount(receivable)}</div></div>
      <div class="card"><div class="card-title">${t("ledger_net")}</div><div class="card-value green">${fmtAmount(payable - receivable)}</div></div>
    </div>
    ` : ""}
    <div class="card">
      ${state.ledger.length === 0 ? `<div class="empty-state"><div class="empty-icon">📖</div><p>${t("ledger_no_data")}</p></div>` :
        state.ledger.map(e => {
          const isCredit = ["payment_received", "goods_returned"].includes(e.entry_type);
          return `
            <div class="entry-item">
              <div class="entry-left">
                <div class="entry-title">${e.party_name} · ${(ENTRY_TYPES[e.entry_type] || (() => e.entry_type))()}</div>
                <div class="entry-sub">${fmtDate(e.date)}${e.item_name ? " · " + e.item_name : ""}${e.quantity ? " · " + e.quantity + " " + (e.unit || "") : ""}</div>
              </div>
              <div class="entry-amount ${isCredit ? "credit" : "debit"}">${isCredit ? "+" : "-"}${fmtAmount(e.amount)}</div>
              <div class="entry-actions">
                <button onclick="deleteLedgerEntry('${e.id}')" title="${t("delete")}">🗑</button>
              </div>
            </div>
          `;
        }).join("")
      }
    </div>
  `;
}

function renderParties() {
  return `
    <div class="add-inline">
      <input class="form-input" id="new-party" placeholder="${t("parties_name")}">
      <button class="btn btn-primary btn-sm" id="add-party-btn">${t("parties_add")}</button>
    </div>
    <div class="card">
      ${state.parties.length === 0 ? `<div class="empty-state"><div class="empty-icon">👥</div><p>${t("parties_no_data")}</p></div>` :
        state.parties.map(p => `
          <div class="entry-item">
            <div class="entry-left">
              <div class="entry-title">${p.name}</div>
              <div class="entry-sub">${p.phone || ""}</div>
            </div>
            <div class="entry-actions">
              <button onclick="deleteParty('${p.id}')" title="${t("delete")}">🗑</button>
            </div>
          </div>
        `).join("")
      }
    </div>
  `;
}

async function addPartyFromInput() {
  const name = $("#new-party")?.value?.trim();
  if (!name) return;
  await api("/api/parties", { method: "POST", body: { name } });
  await loadParties();
  toast(t("success"));
  render();
}

async function deleteParty(id) {
  if (!confirm(t("delete") + "?")) return;
  await api(`/api/parties/${id}`, { method: "DELETE" });
  await loadParties();
  toast(t("success"));
  render();
}

function renderCategories() {
  return `
    <div class="add-inline">
      <input class="form-input" id="new-cat" placeholder="${t("cat_name")}">
      <button class="btn btn-primary btn-sm" id="add-cat-btn">${t("cat_add")}</button>
    </div>
    <div class="card">
      ${state.categories.length === 0 ? `<div class="empty-state"><div class="empty-icon">🏷</div><p>${t("cat_no_data")}</p></div>` :
        state.categories.map(c => `
          <div class="entry-item">
            <div class="entry-left"><div class="entry-title">${c.name}</div></div>
            <div class="entry-actions">
              <button onclick="deleteCategory('${c.id}')" title="${t("delete")}">🗑</button>
            </div>
          </div>
        `).join("")
      }
    </div>
  `;
}

async function addCatFromInput() {
  const name = $("#new-cat")?.value?.trim();
  if (!name) return;
  await api("/api/categories", { method: "POST", body: { name } });
  await loadCategories();
  toast(t("success"));
  render();
}

async function deleteCategory(id) {
  if (!confirm(t("delete") + "?")) return;
  await api(`/api/categories/${id}`, { method: "DELETE" });
  await loadCategories();
  toast(t("success"));
  render();
}

function renderReports() {
  return `
    <div class="preset-bar">
      <button class="preset-chip" data-preset="week">${t("reports_this_week")}</button>
      <button class="preset-chip" data-preset="month">${t("reports_this_month")}</button>
      <button class="preset-chip" data-preset="lastmonth">${t("reports_last_month")}</button>
      <button class="preset-chip" data-preset="fy">${t("reports_this_fy")}</button>
    </div>

    <div class="report-section">
      <h3>📊 ${t("reports_expense")}</h3>
      <div class="filter-bar">
        <div class="filter-group">
          <label>${t("reports_date_from")}</label>
          <input type="date" class="filter-input" id="r-date-from" value="${state.filters.dateFrom}">
        </div>
        <div class="filter-group">
          <label>${t("reports_date_to")}</label>
          <input type="date" class="filter-input" id="r-date-to" value="${state.filters.dateTo}">
        </div>
        <button class="btn btn-primary btn-sm" id="gen-expense-report">${t("reports_generate")}</button>
      </div>
      <div id="expense-report-result"></div>
    </div>

    <div class="report-section">
      <h3>📖 ${t("reports_party")}</h3>
      <div class="filter-bar">
        <div class="filter-group">
          <label>${t("reports_select_party")}</label>
          <select class="filter-select" id="r-party">
            <option value="">${t("ledger_select_party")}</option>
            ${state.parties.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label>${t("reports_date_from")}</label>
          <input type="date" class="filter-input" id="r-party-date-from" value="${state.filters.dateFrom}">
        </div>
        <div class="filter-group">
          <label>${t("reports_date_to")}</label>
          <input type="date" class="filter-input" id="r-party-date-to" value="${state.filters.dateTo}">
        </div>
        <button class="btn btn-primary btn-sm" id="gen-party-report">${t("reports_generate")}</button>
      </div>
      <div id="party-report-result"></div>
    </div>
  `;
}

// ─── Modal ───
function renderModal() {
  if (!state.modalType) return "";

  if (state.modalType === "addPartyFirst") {
    const p = state.parsedData;
    return modalWrapper(`
      <div class="modal-header">
        <h3>${t("confirm_add_party_first")}</h3>
        <button class="modal-close" onclick="rejectEntry()">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:16px;margin-bottom:12px">"<b>${p.party_name}</b>"</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="quickAddParty('${(p.party_name || "").replace(/'/g, "\\'")}')">${t("parties_add")}</button>
        <button class="btn btn-outline" onclick="rejectEntry()">${t("cancel")}</button>
      </div>
    `);
  }

  if (state.modalType === "addCategoryFirst") {
    const p = state.parsedData;
    return modalWrapper(`
      <div class="modal-header">
        <h3>${t("confirm_add_category_first")}</h3>
        <button class="modal-close" onclick="rejectEntry()">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:16px;margin-bottom:12px">"<b>${p.category}</b>"</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="quickAddCategory('${(p.category || "").replace(/'/g, "\\'")}')">${t("cat_add")}</button>
        <button class="btn btn-outline" onclick="rejectEntry()">${t("cancel")}</button>
      </div>
    `);
  }

  if (state.modalType === "confirm") {
    return renderConfirmModal();
  }

  if (state.modalType === "edit") {
    return renderEditModal();
  }

  return "";
}

function modalWrapper(inner) {
  return `<div class="modal-overlay active"><div class="modal">${inner}</div></div>`;
}

function renderConfirmModal() {
  const p = state.parsedData;
  if (!p) return "";

  const isExpense = p.type === "expense";
  const isLedger = p.type === "ledger";

  return modalWrapper(`
    <div class="modal-header">
      <h3>${t("confirm_title")}</h3>
      <button class="modal-close" onclick="rejectEntry()">✕</button>
    </div>
    <div class="modal-body">
      <div class="transcribed-text">🎙 "${p.transcribed_text || p.raw_text || ""}"</div>
      <div class="parsed-preview">
        <div class="parsed-row">
          <span class="parsed-label">${t("confirm_type")}</span>
          <span class="parsed-value">${isExpense ? t("confirm_expense") : t("confirm_ledger")}</span>
        </div>
        ${isExpense ? `
          <div class="parsed-row">
            <span class="parsed-label">${t("confirm_category")}</span>
            <span class="parsed-value">${p.category || "-"}</span>
          </div>
        ` : ""}
        ${isLedger ? `
          <div class="parsed-row">
            <span class="parsed-label">${t("confirm_party")}</span>
            <span class="parsed-value">${p.party_name || "-"}</span>
          </div>
          <div class="parsed-row">
            <span class="parsed-label">${t("confirm_type")}</span>
            <span class="parsed-value">${(ENTRY_TYPES[p.entry_type] || (() => p.entry_type))()}</span>
          </div>
          ${p.item_name ? `<div class="parsed-row"><span class="parsed-label">${t("confirm_item")}</span><span class="parsed-value">${p.item_name}</span></div>` : ""}
          ${p.quantity ? `<div class="parsed-row"><span class="parsed-label">${t("confirm_quantity")}</span><span class="parsed-value">${p.quantity} ${p.unit || ""}</span></div>` : ""}
          ${p.rate ? `<div class="parsed-row"><span class="parsed-label">${t("confirm_rate")}</span><span class="parsed-value">${fmtAmount(p.rate)}</span></div>` : ""}
        ` : ""}
        <div class="parsed-row">
          <span class="parsed-label">${t("confirm_amount")}</span>
          <span class="parsed-value big">${fmtAmount(p.amount)}</span>
        </div>
        <div class="parsed-row">
          <span class="parsed-label">${t("confirm_description")}</span>
          <span class="parsed-value">${p.description || "-"}</span>
        </div>
      </div>
    </div>
    <div class="confirm-actions">
      <button class="confirm-btn accept" onclick="acceptEntry()">${t("confirm_accept")}</button>
      <button class="confirm-btn reject" onclick="rejectEntry()">${t("confirm_reject")}</button>
      <button class="confirm-btn edit-btn" onclick="editEntry()">${t("confirm_edit")}</button>
    </div>
  `);
}

function renderEditModal() {
  const e = state.editData;
  if (!e) return "";

  return modalWrapper(`
    <div class="modal-header">
      <h3>${t("confirm_edit")}</h3>
      <button class="modal-close" onclick="rejectEntry()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>${t("confirm_type")}</label>
        <select class="form-input" id="edit-type">
          <option value="expense" ${e.type === "expense" ? "selected" : ""}>${t("confirm_expense")}</option>
          <option value="ledger" ${e.type === "ledger" ? "selected" : ""}>${t("confirm_ledger")}</option>
        </select>
      </div>

      <div id="edit-expense-fields" class="${e.type !== "expense" ? "hidden" : ""}">
        <div class="form-group">
          <label>${t("confirm_category")}</label>
          <select class="form-input" id="edit-category">
            ${state.categories.map(c => `<option value="${c.name}" ${c.name.toLowerCase() === (e.category || "").toLowerCase() ? "selected" : ""}>${c.name}</option>`).join("")}
          </select>
        </div>
      </div>

      <div id="edit-ledger-fields" class="${e.type !== "ledger" ? "hidden" : ""}">
        <div class="form-group">
          <label>${t("confirm_party")}</label>
          <select class="form-input" id="edit-party">
            ${state.parties.map(p => `<option value="${p.name}" ${p.name.toLowerCase() === (e.party_name || "").toLowerCase() ? "selected" : ""}>${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>${t("confirm_type")}</label>
          <select class="form-input" id="edit-entry-type">
            ${Object.entries(ENTRY_TYPES).map(([k, fn]) => `<option value="${k}" ${k === e.entry_type ? "selected" : ""}>${fn()}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>${t("confirm_item")}</label>
          <input class="form-input" id="edit-item" value="${e.item_name || ""}">
        </div>
        <div class="form-group">
          <label>${t("confirm_quantity")}</label>
          <input class="form-input" id="edit-qty" type="number" step="0.01" value="${e.quantity || ""}">
        </div>
        <div class="form-group">
          <label>${t("confirm_unit")}</label>
          <input class="form-input" id="edit-unit" value="${e.unit || ""}">
        </div>
        <div class="form-group">
          <label>${t("confirm_rate")}</label>
          <input class="form-input" id="edit-rate" type="number" step="0.01" value="${e.rate || ""}">
        </div>
      </div>

      <div class="form-group">
        <label>${t("confirm_amount")}</label>
        <input class="form-input" id="edit-amount" type="number" step="0.01" value="${e.amount || ""}">
      </div>
      <div class="form-group">
        <label>${t("confirm_date")}</label>
        <input class="form-input" id="edit-date" type="date" value="${e.date || todayIST()}">
      </div>
      <div class="form-group">
        <label>${t("confirm_description")}</label>
        <input class="form-input" id="edit-desc" value="${e.description || ""}">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" id="save-edit-btn">${t("save")}</button>
      <button class="btn btn-outline" onclick="rejectEntry()">${t("cancel")}</button>
    </div>
  `);
}

// ─── Events ───
function attachLoginEvents() {
  const form = $("#login-form");
  if (form) form.addEventListener("submit", handleLogin);
}

function attachAppEvents() {
  // Sidebar nav
  document.querySelectorAll(".nav-item[data-page]").forEach(el => {
    el.addEventListener("click", () => {
      state.currentPage = el.dataset.page;
      state.sidebarOpen = false;
      state.filters = { dateFrom: "", dateTo: "", partyId: "", categoryId: "" };
      navigateTo(el.dataset.page);
    });
  });

  // Menu toggle
  const menuBtn = $("#menu-toggle");
  if (menuBtn) menuBtn.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    render();
  });

  // Sidebar backdrop
  const backdrop = $("#sidebar-backdrop");
  if (backdrop) backdrop.addEventListener("click", () => {
    state.sidebarOpen = false;
    render();
  });

  // Voice FAB - press and hold
  const fab = $("#voice-fab");
  if (fab) {
    let holdTimer = null;
    const startHold = (e) => {
      e.preventDefault();
      if (state.isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    };
    fab.addEventListener("mousedown", startHold);
    fab.addEventListener("touchstart", startHold, { passive: false });
  }

  // Filter apply
  const filterBtn = $("#filter-apply");
  if (filterBtn) filterBtn.addEventListener("click", applyFilters);

  // Add party
  const addPartyBtn = $("#add-party-btn");
  if (addPartyBtn) addPartyBtn.addEventListener("click", addPartyFromInput);

  // Add category
  const addCatBtn = $("#add-cat-btn");
  if (addCatBtn) addCatBtn.addEventListener("click", addCatFromInput);

  // Report generation
  const genExpBtn = $("#gen-expense-report");
  if (genExpBtn) genExpBtn.addEventListener("click", generateExpenseReport);

  const genPartyBtn = $("#gen-party-report");
  if (genPartyBtn) genPartyBtn.addEventListener("click", generatePartyReport);

  // Presets
  document.querySelectorAll(".preset-chip[data-preset]").forEach(el => {
    el.addEventListener("click", () => applyPreset(el.dataset.preset));
  });

  // Edit modal type toggle
  const editType = $("#edit-type");
  if (editType) editType.addEventListener("change", () => {
    const v = editType.value;
    const ef = $("#edit-expense-fields");
    const lf = $("#edit-ledger-fields");
    if (ef) ef.classList.toggle("hidden", v !== "expense");
    if (lf) lf.classList.toggle("hidden", v !== "ledger");
    if (state.editData) state.editData.type = v;
  });

  // Save edit
  const saveEditBtn = $("#save-edit-btn");
  if (saveEditBtn) saveEditBtn.addEventListener("click", () => {
    // Collect form data
    const e = state.editData;
    e.type = $("#edit-type")?.value || e.type;
    e.category = $("#edit-category")?.value || e.category;
    e.party_name = $("#edit-party")?.value || e.party_name;
    e.entry_type = $("#edit-entry-type")?.value || e.entry_type;
    e.item_name = $("#edit-item")?.value || "";
    e.quantity = $("#edit-qty")?.value || "";
    e.unit = $("#edit-unit")?.value || "";
    e.rate = $("#edit-rate")?.value || "";
    e.amount = $("#edit-amount")?.value || "";
    e.date = $("#edit-date")?.value || todayIST();
    e.description = $("#edit-desc")?.value || "";
    saveEditedEntry();
  });
}

function applyFilters() {
  state.filters.dateFrom = $("#f-date-from")?.value || "";
  state.filters.dateTo = $("#f-date-to")?.value || "";
  state.filters.categoryId = $("#f-category")?.value || "";
  state.filters.partyId = $("#f-party")?.value || "";

  if (state.currentPage === "expenses") { loadExpenses().then(render); }
  else if (state.currentPage === "ledger") { loadLedger().then(render); }
}

function applyPreset(preset) {
  const today = todayIST();
  let from = "", to = today;

  if (preset === "week") from = weekStart();
  else if (preset === "month") from = monthStart();
  else if (preset === "lastmonth") { [from, to] = lastMonthRange(); }
  else if (preset === "fy") from = fyStart();

  // Update report date inputs
  const rFrom = $("#r-date-from");
  const rTo = $("#r-date-to");
  const rpFrom = $("#r-party-date-from");
  const rpTo = $("#r-party-date-to");
  if (rFrom) rFrom.value = from;
  if (rTo) rTo.value = to;
  if (rpFrom) rpFrom.value = from;
  if (rpTo) rpTo.value = to;

  state.filters.dateFrom = from;
  state.filters.dateTo = to;

  // Highlight active preset
  document.querySelectorAll(".preset-chip").forEach(c => c.classList.remove("active"));
  const active = document.querySelector(`.preset-chip[data-preset="${preset}"]`);
  if (active) active.classList.add("active");
}

async function generateExpenseReport() {
  const from = $("#r-date-from")?.value;
  const to = $("#r-date-to")?.value;
  if (!from || !to) { toast(t("error")); return; }

  const container = $("#expense-report-result");
  if (container) container.innerHTML = `<div class="spinner"></div>`;

  try {
    const res = await api(`/api/reports/expenses?date_from=${from}&date_to=${to}`);
    if (container) {
      const shareUrl = encodeURIComponent(window.location.origin + res.download_url);
      container.innerHTML = `
        <a class="download-link" href="${res.download_url}" download>📥 ${t("reports_download")}</a>
        <a class="download-link whatsapp-link" href="https://wa.me/?text=${encodeURIComponent(t("reports_expense") + ": " + window.location.origin + res.download_url)}" target="_blank">💬 ${t("reports_share")}</a>
      `;
    }
  } catch (err) {
    if (container) container.innerHTML = `<p style="color:var(--danger)">${t("error")}</p>`;
  }
}

async function generatePartyReport() {
  const partyId = $("#r-party")?.value;
  const from = $("#r-party-date-from")?.value;
  const to = $("#r-party-date-to")?.value;
  if (!partyId || !from || !to) { toast(t("error")); return; }

  const container = $("#party-report-result");
  if (container) container.innerHTML = `<div class="spinner"></div>`;

  try {
    const res = await api(`/api/reports/party/${partyId}?date_from=${from}&date_to=${to}`);
    if (container) {
      container.innerHTML = `
        <a class="download-link" href="${res.download_url}" download>📥 ${t("reports_download")}</a>
        <a class="download-link whatsapp-link" href="https://wa.me/?text=${encodeURIComponent(t("reports_party") + ": " + window.location.origin + res.download_url)}" target="_blank">💬 ${t("reports_share")}</a>
      `;
    }
  } catch (err) {
    if (container) container.innerHTML = `<p style="color:var(--danger)">${t("error")}</p>`;
  }
}

// ─── Navigation ───
async function navigateTo(page) {
  state.currentPage = page;
  render();

  try {
    if (page === "home") await loadDashboard();
    else if (page === "expenses") { await loadCategories(); await loadExpenses(); }
    else if (page === "ledger") { await loadParties(); await loadLedger(); }
    else if (page === "parties") await loadParties();
    else if (page === "categories") await loadCategories();
    else if (page === "reports") { await loadParties(); }
  } catch (err) {
    console.error(err);
  }
  render();
}

// ─── Init ───
window.app = { render };
window.deleteExpense = deleteExpense;
window.deleteLedgerEntry = deleteLedgerEntry;
window.deleteParty = deleteParty;
window.deleteCategory = deleteCategory;
window.acceptEntry = acceptEntry;
window.rejectEntry = rejectEntry;
window.editEntry = editEntry;
window.quickAddParty = quickAddParty;
window.quickAddCategory = quickAddCategory;
window.toggleLang = toggleLang;
window.logout = logout;

(async function init() {
  render();
  if (state.token) {
    try {
      await loadCategories();
      await loadParties();
      await loadDashboard();
      render();
    } catch (err) {
      console.error("Init error:", err);
    }
  }
})();
