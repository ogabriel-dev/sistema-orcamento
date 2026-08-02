"use strict";

/* ==========================================================
   ORÇAFÁCIL — script.js
   Sistema de gestão de orçamentos (100% localStorage)
   ========================================================== */

/* ---------------- STORAGE LAYER ----------------
   Isolado em funções próprias para facilitar uma futura
   migração de localStorage para uma API/banco de dados real. */
const DB = {
  KEYS: {
    clients: "orcafacil_clients",
    budgets: "orcafacil_budgets",
    settings: "orcafacil_settings",
    counter: "orcafacil_counter",
    theme: "orcafacil_theme",
  },
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error("Erro ao ler storage", key, e);
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error("Erro ao salvar storage", key, e);
      toast("Não foi possível salvar os dados.", "error");
    }
  },
  getClients() {
    return this.read(this.KEYS.clients, []);
  },
  setClients(v) {
    this.write(this.KEYS.clients, v);
  },
  getBudgets() {
    return this.read(this.KEYS.budgets, []);
  },
  setBudgets(v) {
    this.write(this.KEYS.budgets, v);
  },
  getSettings() {
    return this.read(this.KEYS.settings, {
      companyName: "",
      logo: "",
      phone: "",
      email: "",
      address: "",
      whatsappMsg:
        "Olá {cliente}! Segue o orçamento nº {numero}, no valor de {valor}. Qualquer dúvida estou à disposição.",
    });
  },
  setSettings(v) {
    this.write(this.KEYS.settings, v);
  },
  nextCounter() {
    let n = this.read(this.KEYS.counter, 0) + 1;
    this.write(this.KEYS.counter, n);
    return n;
  },
  peekCounter() {
    return this.read(this.KEYS.counter, 0) + 1;
  },
};

/* ---------------- STATE ---------------- */
let state = {
  clients: DB.getClients(),
  budgets: DB.getBudgets(),
  settings: DB.getSettings(),
  editingBudgetItems: [], // itens de serviço em edição no formulário
  editingBudgetId: null,
  confirmCallback: null,
  viewingBudgetId: null,
};

/* ---------------- UTILS ---------------- */
function uid(prefix) {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

function formatBRL(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("pt-BR");
}

function formatDateInput(iso) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function todayISO() {
  return new Date().toISOString();
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function budgetNumberLabel(num) {
  return "Nº " + String(num).padStart(4, "0");
}

const STATUS_LABELS = {
  pendente: "Pendente",
  enviado: "Enviado",
  aprovado: "Aprovado",
  recusado: "Recusado",
  concluido: "Concluído",
};

/* ---------------- MASKS ---------------- */
function maskPhone(value) {
  let v = value.replace(/\D/g, "").slice(0, 11);
  if (v.length > 10) {
    v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
  } else if (v.length > 5) {
    v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3");
  } else if (v.length > 2) {
    v = v.replace(/(\d{2})(\d{0,5})/, "($1) $2");
  } else if (v.length > 0) {
    v = v.replace(/(\d{0,2})/, "($1");
  }
  return v.trim().replace(/-$/, "");
}

function maskDocument(value) {
  let v = value.replace(/\D/g, "").slice(0, 14);
  if (v.length <= 11) {
    v = v
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  } else {
    v = v
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }
  return v;
}

function attachMask(input, fn) {
  if (!input) return;
  input.addEventListener("input", () => {
    const pos = input.selectionStart;
    const before = input.value.length;
    input.value = fn(input.value);
    const after = input.value.length;
    input.selectionStart = input.selectionEnd = pos + (after - before);
  });
}

/* ---------------- TOASTS ---------------- */
function toast(message, type = "info") {
  const stack = document.getElementById("toastStack");
  const icons = {
    success: "fa-circle-check",
    error: "fa-circle-exclamation",
    info: "fa-circle-info",
  };
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

/* ---------------- NAVIGATION ---------------- */
const PAGE_META = {
  dashboard: { title: "Dashboard", subtitle: "Visão geral do seu negócio" },
  clientes: { title: "Clientes", subtitle: "Gerencie sua base de clientes" },
  "novo-orcamento": {
    title: "Novo orçamento",
    subtitle: "Monte um orçamento profissional",
  },
  historico: { title: "Histórico", subtitle: "Todos os orçamentos criados" },
  relatorios: { title: "Relatórios", subtitle: "Indicadores do seu negócio" },
  configuracoes: {
    title: "Configurações",
    subtitle: "Dados usados nos orçamentos e PDFs",
  },
};

function goToPage(page, opts = {}) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.toggle("active", n.dataset.page === page));
  const target = document.getElementById("page-" + page);
  if (target) target.classList.add("active");
  const meta = PAGE_META[page] || { title: "", subtitle: "" };
  document.getElementById("pageTitle").textContent = meta.title;
  document.getElementById("pageSubtitle").textContent = meta.subtitle;
  closeSidebar();

  if (page === "dashboard") renderDashboard();
  if (page === "clientes") renderClients();
  if (page === "novo-orcamento" && !opts.keepForm) resetBudgetForm();
  if (page === "historico") renderHistory();
  if (page === "relatorios") renderReports();
  if (page === "configuracoes") fillSettingsForm();
  window.scrollTo({
    top: 0,
    behavior: "instant" in window ? "instant" : "auto",
  });
}

document.querySelectorAll("[data-page]").forEach((btn) => {
  btn.addEventListener("click", () => goToPage(btn.dataset.page));
});

/* Sidebar mobile toggle */
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");
function openSidebar() {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("open");
}
function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("open");
}
document.getElementById("menuBtn").addEventListener("click", openSidebar);
document.getElementById("sidebarClose").addEventListener("click", closeSidebar);
sidebarOverlay.addEventListener("click", closeSidebar);

/* ---------------- THEME ---------------- */
function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  const btn = document.getElementById("themeToggle");
  btn.innerHTML =
    theme === "dark"
      ? '<i class="fa-solid fa-sun"></i><span>Modo claro</span>'
      : '<i class="fa-solid fa-moon"></i><span>Modo escuro</span>';
  DB.write(DB.KEYS.theme, theme);
}
document.getElementById("themeToggle").addEventListener("click", () => {
  const current = document.body.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

/* ================================================================
   CLIENTES
   ================================================================ */
function renderClients(filter = "") {
  const tbody = document.getElementById("clientsBody");
  const empty = document.getElementById("clientsEmpty");
  const q = filter.trim().toLowerCase();
  const list = state.clients
    .filter(
      (c) =>
        !q ||
        [c.name, c.company, c.phone, c.city].some((v) =>
          (v || "").toLowerCase().includes(q),
        ),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  tbody.innerHTML = "";
  if (list.length === 0) {
    empty.style.display = "block";
    document.querySelector("#clientsTable").style.display =
      state.clients.length === 0 ? "none" : "table";
    if (state.clients.length > 0) {
      empty.querySelector("p").textContent =
        "Nenhum cliente encontrado para essa pesquisa.";
      empty.querySelector("button").style.display = "none";
    }
    return;
  }
  empty.style.display = "none";
  document.querySelector("#clientsTable").style.display = "table";

  list.forEach((c) => {
    const count = state.budgets.filter((b) => b.clientId === c.id).length;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-strong">${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.company) || '<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td class="cell-mono">${escapeHtml(c.whatsapp || c.phone) || "—"}</td>
      <td>${escapeHtml(c.city) || "—"}</td>
      <td>${count}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Editar" data-edit="${c.id}"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn danger" title="Excluir" data-delete="${c.id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody
    .querySelectorAll("[data-edit]")
    .forEach((b) =>
      b.addEventListener("click", () => openClientModal(b.dataset.edit)),
    );
  tbody
    .querySelectorAll("[data-delete]")
    .forEach((b) =>
      b.addEventListener("click", () => confirmDeleteClient(b.dataset.delete)),
    );
}

document.getElementById("clientSearch").addEventListener(
  "input",
  debounce((e) => renderClients(e.target.value), 150),
);
document
  .getElementById("btnNewClient")
  .addEventListener("click", () => openClientModal());
document
  .getElementById("btnNewClientEmpty")
  .addEventListener("click", () => openClientModal());

const clientModalOverlay = document.getElementById("clientModalOverlay");
const clientForm = document.getElementById("clientForm");
attachMask(document.getElementById("clientPhone"), maskPhone);
attachMask(document.getElementById("clientWhatsapp"), maskPhone);
attachMask(document.getElementById("clientDocument"), maskDocument);

function openClientModal(id = null) {
  clientForm.reset();
  document.getElementById("clientId").value = "";
  if (id) {
    const c = state.clients.find((x) => x.id === id);
    if (!c) return;
    document.getElementById("clientModalTitle").textContent = "Editar cliente";
    document.getElementById("clientId").value = c.id;
    document.getElementById("clientName").value = c.name || "";
    document.getElementById("clientCompany").value = c.company || "";
    document.getElementById("clientPhone").value = c.phone || "";
    document.getElementById("clientWhatsapp").value = c.whatsapp || "";
    document.getElementById("clientEmail").value = c.email || "";
    document.getElementById("clientDocument").value = c.document || "";
    document.getElementById("clientAddress").value = c.address || "";
    document.getElementById("clientCity").value = c.city || "";
    document.getElementById("clientNotes").value = c.notes || "";
  } else {
    document.getElementById("clientModalTitle").textContent = "Novo cliente";
  }
  clientModalOverlay.classList.add("open");
  setTimeout(() => document.getElementById("clientName").focus(), 60);
}
function closeClientModal() {
  clientModalOverlay.classList.remove("open");
}
document
  .getElementById("clientModalClose")
  .addEventListener("click", closeClientModal);
document
  .getElementById("clientCancelBtn")
  .addEventListener("click", closeClientModal);
clientModalOverlay.addEventListener("click", (e) => {
  if (e.target === clientModalOverlay) closeClientModal();
});

document.getElementById("clientSaveBtn").addEventListener("click", () => {
  const name = document.getElementById("clientName").value.trim();
  const whatsapp = document.getElementById("clientWhatsapp").value.trim();
  if (!name) {
    toast("Informe o nome do cliente.", "error");
    document.getElementById("clientName").focus();
    return;
  }
  if (!whatsapp) {
    toast("Informe o WhatsApp do cliente.", "error");
    document.getElementById("clientWhatsapp").focus();
    return;
  }

  const id = document.getElementById("clientId").value;
  const data = {
    name,
    whatsapp,
    company: document.getElementById("clientCompany").value.trim(),
    phone: document.getElementById("clientPhone").value.trim(),
    email: document.getElementById("clientEmail").value.trim(),
    document: document.getElementById("clientDocument").value.trim(),
    address: document.getElementById("clientAddress").value.trim(),
    city: document.getElementById("clientCity").value.trim(),
    notes: document.getElementById("clientNotes").value.trim(),
  };

  if (id) {
    const idx = state.clients.findIndex((c) => c.id === id);
    if (idx > -1) state.clients[idx] = { ...state.clients[idx], ...data };
    toast("Cliente atualizado com sucesso.", "success");
  } else {
    data.id = uid("cli");
    data.createdAt = todayISO();
    state.clients.push(data);
    toast("Cliente cadastrado com sucesso.", "success");
  }
  DB.setClients(state.clients);
  closeClientModal();
  renderClients(document.getElementById("clientSearch").value);
  populateClientSelects();
});

function confirmDeleteClient(id) {
  const c = state.clients.find((x) => x.id === id);
  if (!c) return;
  const linked = state.budgets.filter((b) => b.clientId === id).length;
  openConfirm(
    "Excluir cliente",
    linked > 0
      ? `${c.name} possui ${linked} orçamento(s) vinculado(s). Eles não serão excluídos, mas ficarão sem cliente associado. Deseja continuar?`
      : `Tem certeza que deseja excluir ${c.name}? Esta ação não pode ser desfeita.`,
    () => {
      state.clients = state.clients.filter((x) => x.id !== id);
      DB.setClients(state.clients);
      renderClients(document.getElementById("clientSearch").value);
      populateClientSelects();
      toast("Cliente excluído.", "success");
    },
  );
}

function populateClientSelects() {
  const budgetSel = document.getElementById("budgetClient");
  const filterSel = document.getElementById("filterClient");
  const sortedClients = [...state.clients].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );

  const currentBudgetVal = budgetSel.value;
  budgetSel.innerHTML =
    '<option value="">Escolha um cliente cadastrado...</option>' +
    sortedClients
      .map(
        (c) =>
          `<option value="${c.id}">${escapeHtml(c.name)}${c.company ? " — " + escapeHtml(c.company) : ""}</option>`,
      )
      .join("");
  if (currentBudgetVal) budgetSel.value = currentBudgetVal;

  const currentFilterVal = filterSel.value;
  filterSel.innerHTML =
    '<option value="">Todos os clientes</option>' +
    sortedClients
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join("");
  filterSel.value = currentFilterVal;
}

document
  .getElementById("quickAddClient")
  .addEventListener("click", () => openClientModal());

/* ================================================================
   NOVO ORÇAMENTO
   ================================================================ */
const servicesBody = document.getElementById("servicesBody");

function newServiceRow(item) {
  return {
    id: uid("srv"),
    desc: item?.desc || "",
    qty: item?.qty ?? 1,
    unitPrice: item?.unitPrice ?? 0,
  };
}

function addServiceRow(item) {
  state.editingBudgetItems.push(newServiceRow(item));
  renderServiceRows();
}

function renderServiceRows() {
  servicesBody.innerHTML = "";
  if (state.editingBudgetItems.length === 0) {
    servicesBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:20px;">Nenhum serviço adicionado. Clique em "Adicionar serviço".</td></tr>`;
  }
  state.editingBudgetItems.forEach((item) => {
    const subtotal = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0);
    const tr = document.createElement("tr");
    tr.dataset.id = item.id;
    tr.innerHTML = `
      <td><input type="text" class="desc-input" placeholder="Ex: Instalação elétrica" value="${escapeHtml(item.desc)}" data-field="desc"></td>
      <td><input type="number" class="num-input" min="0" step="1" value="${item.qty}" data-field="qty"></td>
      <td><input type="number" class="num-input" min="0" step="0.01" value="${item.unitPrice}" data-field="unitPrice"></td>
      <td class="col-num cell-mono">${formatBRL(subtotal)}</td>
      <td><button type="button" class="icon-btn danger" title="Remover"><i class="fa-solid fa-trash"></i></button></td>`;
    servicesBody.appendChild(tr);

    tr.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.field;
        const val = field === "desc" ? input.value : Number(input.value);
        const it = state.editingBudgetItems.find((x) => x.id === item.id);
        it[field] = val;
        const sub = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
        tr.querySelector(".col-num.cell-mono").textContent = formatBRL(sub);
        recalcBudgetTotals();
      });
    });
    tr.querySelector(".icon-btn.danger").addEventListener("click", () => {
      state.editingBudgetItems = state.editingBudgetItems.filter(
        (x) => x.id !== item.id,
      );
      renderServiceRows();
      recalcBudgetTotals();
    });
  });
}

document
  .getElementById("btnAddService")
  .addEventListener("click", () => addServiceRow());

function recalcBudgetTotals() {
  const subtotal = state.editingBudgetItems.reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0),
    0,
  );
  const discountVal =
    Number(document.getElementById("budgetDiscount").value) || 0;
  const discountType = document.getElementById("budgetDiscountType").value;
  const feeVal = Number(document.getElementById("budgetFee").value) || 0;
  const feeType = document.getElementById("budgetFeeType").value;

  const discount =
    discountType === "percent" ? subtotal * (discountVal / 100) : discountVal;
  const fee = feeType === "percent" ? subtotal * (feeVal / 100) : feeVal;
  const total = Math.max(0, subtotal - discount + fee);

  document.getElementById("sumSubtotal").textContent = formatBRL(subtotal);
  document.getElementById("sumDiscount").textContent =
    "- " + formatBRL(discount);
  document.getElementById("sumFee").textContent = "+ " + formatBRL(fee);
  document.getElementById("sumTotal").textContent = formatBRL(total);

  return { subtotal, discount, fee, total };
}
["budgetDiscount", "budgetDiscountType", "budgetFee", "budgetFeeType"].forEach(
  (id) => {
    document.getElementById(id).addEventListener("input", recalcBudgetTotals);
    document.getElementById(id).addEventListener("change", recalcBudgetTotals);
  },
);

function resetBudgetForm() {
  state.editingBudgetId = null;
  state.editingBudgetItems = [];
  document.getElementById("budgetForm").reset();
  document.getElementById("budgetId").value = "";
  document.getElementById("budgetDiscount").value = 0;
  document.getElementById("budgetFee").value = 0;
  document.getElementById("budgetStatus").value = "pendente";
  document.getElementById("ticketNumber").textContent = budgetNumberLabel(
    DB.peekCounter(),
  );
  populateClientSelects();
  addServiceRow();
  recalcBudgetTotals();
}

document
  .getElementById("btnCancelBudget")
  .addEventListener("click", () => goToPage("historico"));

document.getElementById("budgetForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const clientId = document.getElementById("budgetClient").value;
  if (!clientId) {
    toast("Selecione um cliente para o orçamento.", "error");
    return;
  }
  const items = state.editingBudgetItems.filter((it) => it.desc.trim() !== "");
  if (items.length === 0) {
    toast("Adicione ao menos um serviço com descrição.", "error");
    return;
  }

  const totals = recalcBudgetTotals();
  const id = document.getElementById("budgetId").value;
  const isEdit = !!id;

  const data = {
    clientId,
    items,
    discount: Number(document.getElementById("budgetDiscount").value) || 0,
    discountType: document.getElementById("budgetDiscountType").value,
    fee: Number(document.getElementById("budgetFee").value) || 0,
    feeType: document.getElementById("budgetFeeType").value,
    paymentMethod: document.getElementById("budgetPayment").value.trim(),
    deadline: document.getElementById("budgetDeadline").value.trim(),
    validUntil: document.getElementById("budgetValidUntil").value,
    status: document.getElementById("budgetStatus").value,
    notes: document.getElementById("budgetNotes").value.trim(),
    subtotal: totals.subtotal,
    total: totals.total,
    updatedAt: todayISO(),
  };

  if (isEdit) {
    const idx = state.budgets.findIndex((b) => b.id === id);
    if (idx > -1) state.budgets[idx] = { ...state.budgets[idx], ...data };
    toast("Orçamento atualizado com sucesso.", "success");
  } else {
    data.id = uid("bud");
    data.number = DB.nextCounter();
    data.createdAt = todayISO();
    state.budgets.push(data);
    toast("Orçamento criado com sucesso.", "success");
  }
  DB.setBudgets(state.budgets);
  goToPage("historico");
});

function loadBudgetForEdit(id) {
  const b = state.budgets.find((x) => x.id === id);
  if (!b) return;
  goToPage("novo-orcamento", { keepForm: true });
  populateClientSelects();
  state.editingBudgetId = id;
  document.getElementById("budgetId").value = b.id;
  document.getElementById("budgetClient").value = b.clientId;
  state.editingBudgetItems = b.items.map((it) => ({ ...it }));
  renderServiceRows();
  document.getElementById("budgetDiscount").value = b.discount || 0;
  document.getElementById("budgetDiscountType").value =
    b.discountType || "value";
  document.getElementById("budgetFee").value = b.fee || 0;
  document.getElementById("budgetFeeType").value = b.feeType || "value";
  document.getElementById("budgetPayment").value = b.paymentMethod || "";
  document.getElementById("budgetDeadline").value = b.deadline || "";
  document.getElementById("budgetValidUntil").value = formatDateInput(
    b.validUntil,
  );
  document.getElementById("budgetStatus").value = b.status || "pendente";
  document.getElementById("budgetNotes").value = b.notes || "";
  document.getElementById("ticketNumber").textContent = budgetNumberLabel(
    b.number,
  );
  recalcBudgetTotals();
}

function duplicateBudget(id) {
  const b = state.budgets.find((x) => x.id === id);
  if (!b) return;
  const copy = {
    ...b,
    id: uid("bud"),
    number: DB.nextCounter(),
    status: "pendente",
    createdAt: todayISO(),
    updatedAt: todayISO(),
    items: b.items.map((it) => ({ ...it, id: uid("srv") })),
  };
  state.budgets.push(copy);
  DB.setBudgets(state.budgets);
  toast(
    `Orçamento duplicado como ${budgetNumberLabel(copy.number)}.`,
    "success",
  );
  renderHistory();
  closeViewModal();
}

/* ================================================================
   HISTÓRICO
   ================================================================ */
function getFilteredBudgets() {
  const q = document.getElementById("historySearch").value.trim().toLowerCase();
  const status = document.getElementById("filterStatus").value;
  const clientId = document.getElementById("filterClient").value;
  const sortBy = document.getElementById("sortBy").value;

  let list = state.budgets.map((b) => ({
    ...b,
    client: state.clients.find((c) => c.id === b.clientId),
  }));

  if (q) {
    list = list.filter(
      (b) =>
        (b.client?.name || "").toLowerCase().includes(q) ||
        String(b.number).includes(q) ||
        budgetNumberLabel(b.number).toLowerCase().includes(q),
    );
  }
  if (status) list = list.filter((b) => b.status === status);
  if (clientId) list = list.filter((b) => b.clientId === clientId);

  list.sort((a, b) => {
    if (sortBy === "date-asc")
      return new Date(a.createdAt) - new Date(b.createdAt);
    if (sortBy === "value-desc") return b.total - a.total;
    if (sortBy === "value-asc") return a.total - b.total;
    return new Date(b.createdAt) - new Date(a.createdAt); // date-desc default
  });
  return list;
}

function renderHistory() {
  populateClientSelects();
  const tbody = document.getElementById("historyBody");
  const empty = document.getElementById("historyEmpty");
  const list = getFilteredBudgets();

  tbody.innerHTML = "";
  document.getElementById("historyTable").style.display = list.length
    ? "table"
    : "none";
  empty.style.display = list.length ? "none" : "block";

  list.forEach((b) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-mono">${budgetNumberLabel(b.number)}</td>
      <td class="cell-strong">${escapeHtml(b.client?.name || "Cliente removido")}</td>
      <td>${formatDate(b.createdAt)}</td>
      <td>${formatDate(b.validUntil)}</td>
      <td class="cell-mono">${formatBRL(b.total)}</td>
      <td><span class="badge badge-${b.status}">${STATUS_LABELS[b.status]}</span></td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Visualizar" data-view="${b.id}"><i class="fa-solid fa-eye"></i></button>
          <button class="icon-btn" title="Editar" data-edit="${b.id}"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn danger" title="Excluir" data-delete="${b.id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody
    .querySelectorAll("[data-view]")
    .forEach((b) =>
      b.addEventListener("click", () => openViewModal(b.dataset.view)),
    );
  tbody
    .querySelectorAll("[data-edit]")
    .forEach((b) =>
      b.addEventListener("click", () => loadBudgetForEdit(b.dataset.edit)),
    );
  tbody
    .querySelectorAll("[data-delete]")
    .forEach((b) =>
      b.addEventListener("click", () => confirmDeleteBudget(b.dataset.delete)),
    );
}

["historySearch"].forEach((id) =>
  document
    .getElementById(id)
    .addEventListener("input", debounce(renderHistory, 150)),
);
["filterStatus", "filterClient", "sortBy"].forEach((id) =>
  document.getElementById(id).addEventListener("change", renderHistory),
);

function confirmDeleteBudget(id) {
  const b = state.budgets.find((x) => x.id === id);
  if (!b) return;
  openConfirm(
    "Excluir orçamento",
    `Tem certeza que deseja excluir o orçamento ${budgetNumberLabel(b.number)}? Esta ação não pode ser desfeita.`,
    () => {
      state.budgets = state.budgets.filter((x) => x.id !== id);
      DB.setBudgets(state.budgets);
      renderHistory();
      toast("Orçamento excluído.", "success");
    },
  );
}

document.getElementById("btnExportCsv").addEventListener("click", () => {
  const list = getFilteredBudgets();
  if (list.length === 0) {
    toast("Nenhum orçamento para exportar.", "error");
    return;
  }
  const header = [
    "Numero",
    "Cliente",
    "Empresa",
    "Data",
    "Validade",
    "Status",
    "Subtotal",
    "Total",
    "FormaPagamento",
  ];
  const rows = list.map((b) => [
    b.number,
    b.client?.name || "",
    b.client?.company || "",
    formatDate(b.createdAt),
    formatDate(b.validUntil),
    STATUS_LABELS[b.status],
    (b.subtotal || 0).toFixed(2).replace(".", ","),
    (b.total || 0).toFixed(2).replace(".", ","),
    b.paymentMethod || "",
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orcamentos_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Histórico exportado em CSV.", "success");
});

/* ================================================================
   VISUALIZAR ORÇAMENTO (modal) + PDF + WHATSAPP
   ================================================================ */
const viewModalOverlay = document.getElementById("viewModalOverlay");
function openViewModal(id) {
  const b = state.budgets.find((x) => x.id === id);
  if (!b) return;
  state.viewingBudgetId = id;
  const client = state.clients.find((c) => c.id === b.clientId);
  const s = state.settings;

  document.getElementById("viewModalTitle").textContent =
    `Orçamento ${budgetNumberLabel(b.number)}`;

  const itemsRows = b.items
    .map(
      (it) => `
    <tr>
      <td>${escapeHtml(it.desc)}</td>
      <td class="num">${it.qty}</td>
      <td class="num">${formatBRL(it.unitPrice)}</td>
      <td class="num">${formatBRL((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}</td>
    </tr>`,
    )
    .join("");

  const discountDisplay =
    b.discountType === "percent" ? `${b.discount}%` : formatBRL(b.discount);
  const feeDisplay = b.feeType === "percent" ? `${b.fee}%` : formatBRL(b.fee);

  document.getElementById("viewModalBody").innerHTML = `
    <div class="view-doc-header">
      <div style="display:flex;gap:12px;align-items:center;">
        <div class="doc-logo">${s.logo ? `<img src="${s.logo}" alt="Logo">` : '<i class="fa-solid fa-store"></i>'}</div>
        <div>
          <div class="view-doc-company">${escapeHtml(s.companyName || "Sua empresa")}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${escapeHtml(s.phone || "")}${s.phone && s.email ? " · " : ""}${escapeHtml(s.email || "")}</div>
        </div>
      </div>
      <div class="view-doc-meta">
        <div class="doc-number">${budgetNumberLabel(b.number)}</div>
        <div>Emitido em ${formatDate(b.createdAt)}</div>
        <div>Válido até ${formatDate(b.validUntil)}</div>
        <span class="badge badge-${b.status}" style="margin-top:6px;">${STATUS_LABELS[b.status]}</span>
      </div>
    </div>
    <div class="view-doc-grid">
      <div class="view-doc-block">
        <h4>Cliente</h4>
        <p><strong>${escapeHtml(client?.name || "Cliente removido")}</strong><br>
        ${escapeHtml(client?.company || "")}${client?.company ? "<br>" : ""}
        ${escapeHtml(client?.whatsapp || client?.phone || "")}<br>
        ${escapeHtml(client?.email || "")}</p>
      </div>
      <div class="view-doc-block">
        <h4>Condições</h4>
        <p>Pagamento: ${escapeHtml(b.paymentMethod) || "—"}<br>
        Prazo: ${escapeHtml(b.deadline) || "—"}</p>
      </div>
    </div>
    <table class="view-doc-table">
      <thead><tr><th>Serviço</th><th class="num">Qtd.</th><th class="num">Valor unit.</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${itemsRows}</tbody>
    </table>
    <div class="view-doc-totals">
      <div class="summary-row"><span>Subtotal</span><span>${formatBRL(b.subtotal)}</span></div>
      <div class="summary-row"><span>Desconto</span><span>- ${discountDisplay}</span></div>
      <div class="summary-row"><span>Taxa</span><span>+ ${feeDisplay}</span></div>
      <div class="summary-row summary-total"><span>Total</span><span>${formatBRL(b.total)}</span></div>
    </div>
    ${b.notes ? `<div class="view-doc-block" style="margin-top:14px;"><h4>Observações</h4><p>${escapeHtml(b.notes)}</p></div>` : ""}
  `;
  viewModalOverlay.classList.add("open");
}
function closeViewModal() {
  viewModalOverlay.classList.remove("open");
  state.viewingBudgetId = null;
}
document
  .getElementById("viewModalClose")
  .addEventListener("click", closeViewModal);
viewModalOverlay.addEventListener("click", (e) => {
  if (e.target === viewModalOverlay) closeViewModal();
});

document.getElementById("btnEditFromView").addEventListener("click", () => {
  const id = state.viewingBudgetId;
  closeViewModal();
  loadBudgetForEdit(id);
});
document
  .getElementById("btnDuplicate")
  .addEventListener("click", () => duplicateBudget(state.viewingBudgetId));

document.getElementById("btnWhatsapp").addEventListener("click", () => {
  const b = state.budgets.find((x) => x.id === state.viewingBudgetId);
  if (!b) return;
  const client = state.clients.find((c) => c.id === b.clientId);
  if (!client || !client.whatsapp) {
    toast("Este cliente não possui WhatsApp cadastrado.", "error");
    return;
  }
  const phoneDigits = client.whatsapp.replace(/\D/g, "");
  const phoneWithCountry = phoneDigits.startsWith("55")
    ? phoneDigits
    : "55" + phoneDigits;

  let msg =
    state.settings.whatsappMsg ||
    "Olá {cliente}! Segue o orçamento nº {numero}, no valor de {valor}.";
  msg = msg
    .replace(/{cliente}/g, client.name)
    .replace(/{numero}/g, budgetNumberLabel(b.number))
    .replace(/{valor}/g, formatBRL(b.total));
  msg += "\n\n(Link do PDF: gere e anexe o arquivo exportado por aqui.)";

  const url = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
});

document
  .getElementById("btnPdf")
  .addEventListener("click", () => generatePdf(state.viewingBudgetId));

function generatePdf(id) {
  const b = state.budgets.find((x) => x.id === id);
  if (!b) return;
  const client = state.clients.find((c) => c.id === b.clientId);
  const s = state.settings;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const primary = [18, 100, 92];
  const gray = [110, 112, 120];

  doc.setFillColor(...primary);
  doc.rect(0, 0, 210, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(s.companyName || "Sua empresa", 14, 15);
  doc.setFontSize(10);
  doc.text([s.phone, s.email].filter(Boolean).join("   ·   "), 14, 22);
  doc.setFontSize(13);
  doc.text(budgetNumberLabel(b.number), 196, 15, { align: "right" });
  doc.setFontSize(9);
  doc.text("Emitido em " + formatDate(b.createdAt), 196, 21, {
    align: "right",
  });
  doc.text("Válido até " + formatDate(b.validUntil), 196, 26, {
    align: "right",
  });

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(11);
  doc.text("Cliente", 14, 42);
  doc.setFontSize(9.5);
  doc.setTextColor(...gray);
  const clientLines = [
    client?.name || "Cliente removido",
    client?.company || "",
    client?.whatsapp || client?.phone || "",
    client?.email || "",
    [client?.address, client?.city].filter(Boolean).join(" — "),
  ].filter(Boolean);
  doc.text(clientLines, 14, 48);

  doc.autoTable({
    startY: 48 + clientLines.length * 4.6 + 6,
    head: [["Serviço", "Qtd.", "Valor unit.", "Subtotal"]],
    body: b.items.map((it) => [
      it.desc,
      String(it.qty),
      formatBRL(it.unitPrice),
      formatBRL((Number(it.qty) || 0) * (Number(it.unitPrice) || 0)),
    ]),
    theme: "grid",
    headStyles: { fillColor: primary, textColor: 255, fontSize: 9.5 },
    styles: { fontSize: 9.5, textColor: [40, 40, 40] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
    },
  });

  let y = doc.lastAutoTable.finalY + 8;
  const discountDisplay =
    b.discountType === "percent" ? `${b.discount}%` : formatBRL(b.discount);
  const feeDisplay = b.feeType === "percent" ? `${b.fee}%` : formatBRL(b.fee);
  const totalsX = 196;
  doc.setFontSize(9.5);
  doc.setTextColor(...gray);
  doc.text(`Subtotal:  ${formatBRL(b.subtotal)}`, totalsX, y, {
    align: "right",
  });
  y += 5.5;
  doc.text(`Desconto:  - ${discountDisplay}`, totalsX, y, { align: "right" });
  y += 5.5;
  doc.text(`Taxa:  + ${feeDisplay}`, totalsX, y, { align: "right" });
  y += 7;
  doc.setFontSize(13);
  doc.setTextColor(...primary);
  doc.text(`Total:  ${formatBRL(b.total)}`, totalsX, y, { align: "right" });
  y += 12;

  doc.setFontSize(9.5);
  doc.setTextColor(30, 30, 30);
  if (b.paymentMethod) {
    doc.text(`Forma de pagamento: ${b.paymentMethod}`, 14, y);
    y += 6;
  }
  if (b.deadline) {
    doc.text(`Prazo de execução: ${b.deadline}`, 14, y);
    y += 6;
  }
  if (b.notes) {
    doc.text("Observações:", 14, y);
    y += 5;
    doc.setTextColor(...gray);
    const notesLines = doc.splitTextToSize(b.notes, 180);
    doc.text(notesLines, 14, y);
    y += notesLines.length * 5 + 6;
  }

  y = Math.max(y, 250);
  doc.setDrawColor(200, 200, 200);
  doc.line(14, y, 90, y);
  doc.setFontSize(8.5);
  doc.setTextColor(...gray);
  doc.text("Assinatura", 14, y + 5);
  doc.text(s.address || "", 14, 288);

  doc.save(`orcamento_${budgetNumberLabel(b.number).replace("Nº ", "")}.pdf`);
  toast("PDF gerado com sucesso.", "success");
}

/* ================================================================
   CONFIRM MODAL (genérico)
   ================================================================ */
const confirmModalOverlay = document.getElementById("confirmModalOverlay");
function openConfirm(title, message, callback) {
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmMessage").textContent = message;
  state.confirmCallback = callback;
  confirmModalOverlay.classList.add("open");
}
function closeConfirm() {
  confirmModalOverlay.classList.remove("open");
  state.confirmCallback = null;
}
document
  .getElementById("confirmModalClose")
  .addEventListener("click", closeConfirm);
document
  .getElementById("confirmCancelBtn")
  .addEventListener("click", closeConfirm);
confirmModalOverlay.addEventListener("click", (e) => {
  if (e.target === confirmModalOverlay) closeConfirm();
});
document.getElementById("confirmOkBtn").addEventListener("click", () => {
  if (state.confirmCallback) state.confirmCallback();
  closeConfirm();
});

/* ================================================================
   DASHBOARD
   ================================================================ */
function renderDashboard() {
  const budgets = state.budgets;
  document.getElementById("statClients").textContent = state.clients.length;
  document.getElementById("statBudgets").textContent = budgets.length;
  document.getElementById("statTotal").textContent = formatBRL(
    budgets.reduce((s, b) => s + (b.total || 0), 0),
  );
  document.getElementById("statApproved").textContent = budgets.filter(
    (b) => b.status === "aprovado",
  ).length;
  document.getElementById("statPending").textContent = budgets.filter(
    (b) => b.status === "pendente",
  ).length;
  document.getElementById("statRejected").textContent = budgets.filter(
    (b) => b.status === "recusado",
  ).length;

  const recent = [...budgets]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);
  const tbody = document.getElementById("recentBudgetsBody");
  tbody.innerHTML = "";
  document.getElementById("dashboardEmpty").style.display = budgets.length
    ? "none"
    : "block";
  document.getElementById("recentBudgetsTable").style.display = budgets.length
    ? "table"
    : "none";

  recent.forEach((b) => {
    const client = state.clients.find((c) => c.id === b.clientId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-mono">${budgetNumberLabel(b.number)}</td>
      <td class="cell-strong">${escapeHtml(client?.name || "Cliente removido")}</td>
      <td>${formatDate(b.createdAt)}</td>
      <td class="cell-mono">${formatBRL(b.total)}</td>
      <td><span class="badge badge-${b.status}">${STATUS_LABELS[b.status]}</span></td>
      <td><button class="icon-btn" title="Visualizar" data-view="${b.id}"><i class="fa-solid fa-eye"></i></button></td>`;
    tbody.appendChild(tr);
  });
  tbody
    .querySelectorAll("[data-view]")
    .forEach((b) =>
      b.addEventListener("click", () => openViewModal(b.dataset.view)),
    );
}

/* ================================================================
   RELATÓRIOS (Chart.js)
   ================================================================ */
let charts = {};
function chartColors() {
  const style = getComputedStyle(document.body);
  return {
    text: style.getPropertyValue("--text-secondary").trim(),
    grid: style.getPropertyValue("--border").trim(),
    primary: style.getPropertyValue("--primary").trim(),
    amber: style.getPropertyValue("--amber").trim(),
    blue: style.getPropertyValue("--blue").trim(),
    green: style.getPropertyValue("--green").trim(),
    red: style.getPropertyValue("--red").trim(),
    violet: style.getPropertyValue("--violet").trim(),
  };
}

function renderReports() {
  const c = chartColors();
  Object.values(charts).forEach((ch) => ch.destroy());
  charts = {};

  // Últimos 6 meses
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
    });
  }
  const countByMonth = months.map(
    (m) =>
      state.budgets.filter((b) => {
        const d = new Date(b.createdAt);
        return `${d.getFullYear()}-${d.getMonth()}` === m.key;
      }).length,
  );
  const revenueByMonth = months.map((m) =>
    state.budgets
      .filter((b) => {
        const d = new Date(b.createdAt);
        return (
          `${d.getFullYear()}-${d.getMonth()}` === m.key &&
          b.status !== "recusado"
        );
      })
      .reduce((s, b) => s + (b.total || 0), 0),
  );

  const commonGrid = { color: c.grid };
  const commonTicks = { color: c.text, font: { family: "Inter" } };

  charts.byMonth = new Chart(document.getElementById("chartByMonth"), {
    type: "bar",
    data: {
      labels: months.map((m) => m.label),
      datasets: [
        {
          label: "Orçamentos",
          data: countByMonth,
          backgroundColor: c.primary,
          borderRadius: 6,
          maxBarThickness: 34,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: commonTicks },
        y: {
          beginAtZero: true,
          ticks: { ...commonTicks, precision: 0 },
          grid: commonGrid,
        },
      },
    },
  });

  const statusKeys = [
    "pendente",
    "enviado",
    "aprovado",
    "recusado",
    "concluido",
  ];
  const statusColors = [c.amber, c.blue, c.green, c.red, c.violet];
  const statusCounts = statusKeys.map(
    (k) => state.budgets.filter((b) => b.status === k).length,
  );
  charts.byStatus = new Chart(document.getElementById("chartByStatus"), {
    type: "doughnut",
    data: {
      labels: statusKeys.map((k) => STATUS_LABELS[k]),
      datasets: [
        { data: statusCounts, backgroundColor: statusColors, borderWidth: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: c.text,
            boxWidth: 10,
            padding: 14,
            font: { family: "Inter", size: 11.5 },
          },
        },
      },
      cutout: "62%",
    },
  });

  charts.revenue = new Chart(document.getElementById("chartRevenue"), {
    type: "line",
    data: {
      labels: months.map((m) => m.label),
      datasets: [
        {
          label: "Faturamento",
          data: revenueByMonth,
          borderColor: c.primary,
          backgroundColor: c.primary + "26",
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: c.primary,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: commonTicks },
        y: {
          beginAtZero: true,
          ticks: { ...commonTicks, callback: (v) => "R$ " + v },
          grid: commonGrid,
        },
      },
    },
  });

  const clientTotals = state.clients
    .map((cl) => ({
      name: cl.name,
      count: state.budgets.filter((b) => b.clientId === cl.id).length,
    }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  charts.topClients = new Chart(document.getElementById("chartTopClients"), {
    type: "bar",
    data: {
      labels: clientTotals.map((x) => x.name),
      datasets: [
        {
          label: "Orçamentos",
          data: clientTotals.map((x) => x.count),
          backgroundColor: c.primary,
          borderRadius: 6,
          maxBarThickness: 22,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { ...commonTicks, precision: 0 },
          grid: commonGrid,
        },
        y: { grid: { display: false }, ticks: commonTicks },
      },
    },
  });
}

/* ================================================================
   CONFIGURAÇÕES
   ================================================================ */
attachMask(document.getElementById("settingsPhone"), maskPhone);

function fillSettingsForm() {
  const s = state.settings;
  document.getElementById("settingsName").value = s.companyName || "";
  document.getElementById("settingsPhone").value = s.phone || "";
  document.getElementById("settingsEmail").value = s.email || "";
  document.getElementById("settingsAddress").value = s.address || "";
  document.getElementById("settingsWhatsappMsg").value = s.whatsappMsg || "";
  updateLogoPreview(s.logo);
}

function updateLogoPreview(logo) {
  const preview = document.getElementById("logoPreview");
  preview.innerHTML = logo
    ? `<img src="${logo}" alt="Logo">`
    : '<i class="fa-solid fa-store"></i>';
  const sidebarLogo = document.getElementById("sidebarCompanyLogo");
  sidebarLogo.innerHTML = logo
    ? `<img src="${logo}" alt="Logo">`
    : '<i class="fa-solid fa-store"></i>';
}

document.getElementById("settingsLogo").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 1024 * 1024) {
    toast("A imagem deve ter no máximo 1MB.", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    updateLogoPreview(reader.result);
    state.settings._tempLogo = reader.result;
  };
  reader.readAsDataURL(file);
});
document.getElementById("removeLogo").addEventListener("click", () => {
  updateLogoPreview("");
  state.settings._tempLogo = "";
});

document.getElementById("settingsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const logoImg = document.getElementById("logoPreview").querySelector("img");
  state.settings = {
    ...state.settings,
    companyName: document.getElementById("settingsName").value.trim(),
    phone: document.getElementById("settingsPhone").value.trim(),
    email: document.getElementById("settingsEmail").value.trim(),
    address: document.getElementById("settingsAddress").value.trim(),
    whatsappMsg: document.getElementById("settingsWhatsappMsg").value.trim(),
    logo: logoImg ? logoImg.src : "",
  };
  delete state.settings._tempLogo;
  DB.setSettings(state.settings);
  document.getElementById("sidebarCompanyName").textContent =
    state.settings.companyName || "Minha Empresa";
  toast("Configurações salvas com sucesso.", "success");
});

/* ================================================================
   INIT
   ================================================================ */
function init() {
  const savedTheme = DB.read(DB.KEYS.theme, "light");
  applyTheme(savedTheme);

  document.getElementById("sidebarCompanyName").textContent =
    state.settings.companyName || "Minha Empresa";
  updateLogoPreview(state.settings.logo);

  populateClientSelects();
  resetBudgetForm();
  renderDashboard();

  // Re-render charts on theme change to pick up new CSS var colors
  const observer = new MutationObserver(() => {
    if (document.getElementById("page-relatorios").classList.contains("active"))
      renderReports();
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

init();
