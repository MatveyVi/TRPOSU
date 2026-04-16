const state = {
  transportTypes: [],
  points: [],
  activeRentals: [],
  operationLog: []
};

const page = document.body.dataset.page || "home";
const typeLabels = {
  add: "Добавление",
  rent: "Прокат",
  buy: "Покупка",
  return: "Возврат"
};

const elements = {
  rentalCounter: document.getElementById("rentalCounter"),
  pointsGrid: document.getElementById("pointsGrid"),
  statusPointsGrid: document.getElementById("statusPointsGrid"),
  returnPointSelect: document.getElementById("returnPointSelect"),
  returnRentalSelect: document.getElementById("returnRentalSelect"),
  returnButton: document.getElementById("returnButton"),
  infoLine: document.getElementById("infoLine"),
  addPointSelect: document.getElementById("addPointSelect"),
  rentPointSelect: document.getElementById("rentPointSelect"),
  statusPointSelect: document.getElementById("statusPointSelect"),
  addTypeGroup: document.getElementById("addTypeGroup"),
  rentTypeGroup: document.getElementById("rentTypeGroup"),
  addForm: document.getElementById("addForm"),
  rentForm: document.getElementById("rentForm"),
  statusOutput: document.getElementById("statusOutput"),
  statusProgressBar: document.getElementById("statusProgressBar"),
  statusProgressText: document.getElementById("statusProgressText"),
  statusPointFacts: document.getElementById("statusPointFacts"),
  activeRentalsList: document.getElementById("activeRentalsList"),
  operationsPreview: document.getElementById("operationsPreview"),
  operationLogList: document.getElementById("operationLogList"),
  popupModal: document.getElementById("popupModal"),
  popupTitle: document.getElementById("popupTitle"),
  popupMessage: document.getElementById("popupMessage"),
  popupOkButton: document.getElementById("popupOkButton")
};

const modalIds = ["addModal", "rentModal", "popupModal"];

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Произошла ошибка запроса.");
  }

  return payload;
}

function setInfo(text) {
  if (elements.infoLine) {
    elements.infoLine.textContent = text;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value) {
  if (!value) {
    return "нет данных";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function setActiveNav() {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.nav === page);
  });
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);

  if (!modal) {
    return;
  }

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);

  if (!modal) {
    return;
  }

  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function closeAllActionModals() {
  modalIds.forEach((modalId) => {
    if (modalId !== "popupModal") {
      closeModal(modalId);
    }
  });
}

function showPopup(title, message) {
  if (!elements.popupModal || !elements.popupTitle || !elements.popupMessage) {
    window.alert(message);
    return;
  }

  elements.popupTitle.textContent = title;
  elements.popupMessage.textContent = message;
  openModal("popupModal");
}

function buildPointCard(point, allowQuickActions) {
  const inventoryItems = point.inventory
    .map(
      (item) => `
        <li class="inventory-row">
          <span class="transport-name">${escapeHtml(item.label)}</span>
          <span class="transport-count">${escapeHtml(item.availableCount)} шт.</span>
        </li>
      `
    )
    .join("");

  const actions = allowQuickActions
    ? `
        <div class="point-actions">
          <button
            type="button"
            class="ghost"
            data-open-modal="addModal"
            data-prefill-point="${escapeHtml(point.code)}"
          >
            пополнить
          </button>
          <button
            type="button"
            class="secondary"
            data-open-modal="rentModal"
            data-prefill-point="${escapeHtml(point.code)}"
          >
            снять
          </button>
        </div>
      `
    : "";

  return `
    <article class="point-card">
      <div class="point-top">
        <div>
          <h3>${escapeHtml(point.name)}</h3>
          <p class="section-note">Код точки: ${escapeHtml(point.code)}</p>
        </div>
        <span class="point-capacity">${point.currentCount} из ${point.capacity}</span>
      </div>
      <ul class="inventory-list">${inventoryItems}</ul>
      <div class="point-progress">
        <div class="point-progress-head">
          <span>Наполненность</span>
          <span>${point.fillPercent}%</span>
        </div>
        <progress max="${point.capacity}" value="${point.currentCount}"></progress>
      </div>
      <div class="point-meta">
        <span class="meta-chip">Свободно мест: ${point.freeSlots}</span>
        <span class="meta-chip">Типов транспорта: ${point.inventory.length}</span>
      </div>
      ${actions}
    </article>
  `;
}

function renderPointCards() {
  [
    { element: elements.pointsGrid, allowQuickActions: true },
    { element: elements.statusPointsGrid, allowQuickActions: false }
  ].forEach(({ element, allowQuickActions }) => {
    if (!element) {
      return;
    }

    if (state.points.length === 0) {
      element.innerHTML =
        '<div class="empty-state">Точки проката не найдены.</div>';
      return;
    }

    element.innerHTML = state.points
      .map((point) => buildPointCard(point, allowQuickActions))
      .join("");
  });

  if (elements.rentalCounter) {
    elements.rentalCounter.textContent = `Снято: ${state.activeRentals.length}`;
  }
}

function setSelectOptions(selectElement, options) {
  if (!selectElement) {
    return;
  }

  const currentValue = selectElement.value;

  selectElement.innerHTML = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
    )
    .join("");

  const hasCurrentValue = options.some((option) => option.value === currentValue);
  selectElement.value = hasCurrentValue
    ? currentValue
    : options[0]?.value || "";
}

function renderPointSelects() {
  const pointOptions = state.points.map((point) => ({
    value: point.code,
    label: point.name
  }));

  setSelectOptions(elements.returnPointSelect, pointOptions);
  setSelectOptions(elements.addPointSelect, pointOptions);
  setSelectOptions(elements.rentPointSelect, pointOptions);
  setSelectOptions(elements.statusPointSelect, pointOptions);
}

function renderTypeRadios(targetElement, inputName) {
  if (!targetElement) {
    return;
  }

  const previousValue = targetElement.querySelector("input:checked")?.value;

  targetElement.innerHTML = state.transportTypes
    .map(
      (type, index) => `
        <label class="radio-option">
          <input
            type="radio"
            name="${inputName}"
            value="${escapeHtml(type.code)}"
            ${
              previousValue
                ? previousValue === type.code
                  ? "checked"
                  : ""
                : index === 0
                  ? "checked"
                  : ""
            }
          />
          ${escapeHtml(type.label)}
        </label>
      `
    )
    .join("");
}

function renderRentalSelect() {
  if (!elements.returnRentalSelect) {
    return;
  }

  if (state.activeRentals.length === 0) {
    elements.returnRentalSelect.innerHTML =
      '<option value="">Нет снятого транспорта</option>';

    if (elements.returnButton) {
      elements.returnButton.disabled = true;
    }

    return;
  }

  const currentValue = elements.returnRentalSelect.value;

  elements.returnRentalSelect.innerHTML = state.activeRentals
    .map(
      (rental) => `
        <option value="${escapeHtml(rental.id)}">
          ${escapeHtml(rental.id)} — ${escapeHtml(rental.transportTypeLabel)} (${escapeHtml(
            rental.sourcePointName
          )})
        </option>
      `
    )
    .join("");

  const hasCurrentValue = state.activeRentals.some((rental) => rental.id === currentValue);
  elements.returnRentalSelect.value = hasCurrentValue
    ? currentValue
    : state.activeRentals[0].id;

  if (elements.returnButton) {
    elements.returnButton.disabled = false;
  }
}

function renderStatusDetails() {
  if (!elements.statusPointSelect) {
    return;
  }

  const selectedCode = elements.statusPointSelect.value || state.points[0]?.code;
  const point = state.points.find((item) => item.code === selectedCode);

  if (!point) {
    if (elements.statusOutput) {
      elements.statusOutput.value = "";
    }

    if (elements.statusProgressBar) {
      elements.statusProgressBar.value = 0;
      elements.statusProgressBar.max = 0;
    }

    if (elements.statusProgressText) {
      elements.statusProgressText.textContent = "0 из 0";
    }

    if (elements.statusPointFacts) {
      elements.statusPointFacts.innerHTML = "";
    }

    return;
  }

  if (elements.statusOutput) {
    elements.statusOutput.value = point.textStatus;
  }

  if (elements.statusProgressBar) {
    elements.statusProgressBar.max = point.capacity;
    elements.statusProgressBar.value = point.currentCount;
  }

  if (elements.statusProgressText) {
    elements.statusProgressText.textContent = `${point.currentCount} из ${point.capacity} (${point.fillPercent}%)`;
  }

  if (elements.statusPointFacts) {
    elements.statusPointFacts.innerHTML = `
      <div class="fact-item">
        <span class="section-note">Свободные места</span>
        <strong>${point.freeSlots}</strong>
      </div>
      <div class="fact-item">
        <span class="section-note">Типов транспорта</span>
        <strong>${point.inventory.length}</strong>
      </div>
      <div class="fact-item">
        <span class="section-note">Максимум на точке</span>
        <strong>${point.capacity}</strong>
      </div>
    `;
  }
}

function getBadgeClass(type) {
  if (type === "add") {
    return "badge badge-add";
  }

  if (type === "rent") {
    return "badge badge-rent";
  }

  if (type === "buy") {
    return "badge badge-buy";
  }

  return "badge badge-return";
}

function buildOperationMarkup(entries) {
  if (!entries || entries.length === 0) {
    return '<div class="empty-state">Операций пока нет.</div>';
  }

  return entries
    .map((entry) => {
      const rentalIds =
        Array.isArray(entry.rentalIds) && entry.rentalIds.length > 0
          ? `ID: ${entry.rentalIds.join(", ")}`
          : "Без идентификаторов";

      return `
        <article class="activity-item">
          <div class="activity-head">
            <strong>${escapeHtml(typeLabels[entry.type] || "Операция")}</strong>
            <span class="${getBadgeClass(entry.type)}">${escapeHtml(entry.type)}</span>
          </div>
          <div class="activity-body">${escapeHtml(entry.message)}</div>
          <div class="activity-extra">${escapeHtml(rentalIds)}</div>
          <div class="activity-time">${escapeHtml(formatDate(entry.createdAt))}</div>
        </article>
      `;
    })
    .join("");
}

function renderOperationLog() {
  if (elements.operationsPreview) {
    elements.operationsPreview.innerHTML = buildOperationMarkup(state.operationLog.slice(0, 5));
  }

  if (elements.operationLogList) {
    elements.operationLogList.innerHTML = buildOperationMarkup(state.operationLog);
  }
}

function buildRentalsMarkup() {
  if (state.activeRentals.length === 0) {
    return '<div class="empty-state">Активных аренд сейчас нет.</div>';
  }

  return state.activeRentals
    .map(
      (rental) => `
        <article class="rental-item">
          <div class="rental-head">
            <strong>${escapeHtml(rental.id)}</strong>
            <span class="badge badge-rent">${escapeHtml(rental.transportTypeLabel)}</span>
          </div>
          <div class="rental-body">
            Исходный пункт: ${escapeHtml(rental.sourcePointName)}
          </div>
          <div class="rental-meta">Выдано: ${escapeHtml(formatDate(rental.rentedAt))}</div>
        </article>
      `
    )
    .join("");
}

function renderActiveRentals() {
  if (elements.activeRentalsList) {
    elements.activeRentalsList.innerHTML = buildRentalsMarkup();
  }
}

function renderAll() {
  renderPointCards();
  renderPointSelects();
  renderTypeRadios(elements.addTypeGroup, "transportTypeCode");
  renderTypeRadios(elements.rentTypeGroup, "transportTypeCode");
  renderRentalSelect();
  renderStatusDetails();
  renderActiveRentals();
  renderOperationLog();
}

function applyState(nextState) {
  state.transportTypes = nextState.transportTypes || [];
  state.points = nextState.points || [];
  state.activeRentals = nextState.activeRentals || [];
  state.operationLog = nextState.operationLog || [];
  renderAll();
}

async function loadState() {
  const payload = await api("/api/bootstrap");
  applyState(payload);
}

function updateStateFromResponse(payload) {
  if (payload.state) {
    applyState(payload.state);
  }
}

function formToPayload(form) {
  const formData = new FormData(form);
  return Object.fromEntries(formData.entries());
}

function resetAddForm() {
  if (!elements.addForm) {
    return;
  }

  elements.addForm.reset();
  if (elements.addForm.elements.quantity) {
    elements.addForm.elements.quantity.value = "1";
  }
}

function resetRentForm() {
  if (!elements.rentForm) {
    return;
  }

  elements.rentForm.reset();
  if (elements.rentForm.elements.quantity) {
    elements.rentForm.elements.quantity.value = "1";
  }
  if (elements.rentForm.elements.buy) {
    elements.rentForm.elements.buy.checked = false;
  }
}

function prefillPoint(modalId, pointCode) {
  if (!pointCode) {
    return;
  }

  if (modalId === "addModal" && elements.addPointSelect) {
    elements.addPointSelect.value = pointCode;
  }

  if (modalId === "rentModal" && elements.rentPointSelect) {
    elements.rentPointSelect.value = pointCode;
  }
}

function buildRentSuccessMessage(responsePayload) {
  if (!responsePayload.rentalIds || responsePayload.rentalIds.length === 0) {
    return responsePayload.message;
  }

  return `${responsePayload.message}\nИдентификаторы: ${responsePayload.rentalIds.join(", ")}`;
}

async function handleAddSubmit(event) {
  event.preventDefault();

  try {
    const payload = formToPayload(elements.addForm);
    const responsePayload = await api("/api/transport/add", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    updateStateFromResponse(responsePayload);
    closeModal("addModal");
    resetAddForm();
    setInfo(responsePayload.message);
    showPopup("Операция выполнена", responsePayload.message);
  } catch (error) {
    showPopup("Ошибка", error.message);
  }
}

async function handleRentSubmit(event) {
  event.preventDefault();

  try {
    const payload = formToPayload(elements.rentForm);
    payload.buy = Boolean(elements.rentForm.elements.buy.checked);

    const responsePayload = await api("/api/transport/rent", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    updateStateFromResponse(responsePayload);
    closeModal("rentModal");
    resetRentForm();
    setInfo(responsePayload.message);
    showPopup("Операция выполнена", buildRentSuccessMessage(responsePayload));
  } catch (error) {
    showPopup("Ошибка", error.message);
  }
}

async function handleReturn() {
  try {
    const responsePayload = await api("/api/transport/return", {
      method: "POST",
      body: JSON.stringify({
        pointCode: elements.returnPointSelect.value,
        rentalId: elements.returnRentalSelect.value
      })
    });

    updateStateFromResponse(responsePayload);
    setInfo(responsePayload.message);
    showPopup("Операция выполнена", responsePayload.message);
  } catch (error) {
    showPopup("Ошибка", error.message);
  }
}

function attachModalEvents() {
  modalIds.forEach((modalId) => {
    const modal = document.getElementById(modalId);

    if (!modal) {
      return;
    }

    modal.addEventListener("click", (event) => {
      if (event.target === modal && modalId !== "popupModal") {
        closeModal(modalId);
      }
    });
  });
}

function attachEvents() {
  document.addEventListener("click", (event) => {
    const openTrigger = event.target.closest("[data-open-modal]");
    if (openTrigger) {
      const modalId = openTrigger.dataset.openModal;

      if (modalId === "addModal") {
        resetAddForm();
      }

      if (modalId === "rentModal") {
        resetRentForm();
      }

      prefillPoint(modalId, openTrigger.dataset.prefillPoint);
      openModal(modalId);
      return;
    }

    const closeTrigger = event.target.closest("[data-close-modal]");
    if (closeTrigger) {
      closeModal(closeTrigger.dataset.closeModal);
    }
  });

  if (elements.popupOkButton) {
    elements.popupOkButton.addEventListener("click", () => {
      closeModal("popupModal");
    });
  }

  if (elements.addForm) {
    elements.addForm.addEventListener("submit", handleAddSubmit);
  }

  if (elements.rentForm) {
    elements.rentForm.addEventListener("submit", handleRentSubmit);
  }

  if (elements.returnButton) {
    elements.returnButton.addEventListener("click", handleReturn);
  }

  if (elements.statusPointSelect) {
    elements.statusPointSelect.addEventListener("change", renderStatusDetails);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllActionModals();
      closeModal("popupModal");
    }
  });

  attachModalEvents();
}

async function init() {
  setActiveNav();
  attachEvents();

  try {
    await loadState();
  } catch (error) {
    setInfo("Не удалось загрузить начальное состояние.");
    showPopup("Ошибка", error.message);
  }
}

init();
