(() => {
  "use strict";

  const STORAGE_KEY = "thermowise.measurements.v1";
  const THEME_KEY = "thermowise.theme";
  const fuels = {
    diesel: { name: "Diésel", heatingValue: 11.86 },
    "gas-natural": { name: "Gas natural", heatingValue: 13.9 },
    "fuel-oil": { name: "Fuel oil", heatingValue: 11.2 },
    gasolina: { name: "Gasolina", heatingValue: 12.1 },
    glp: { name: "GLP", heatingValue: 12.8 }
  };
  const form = document.getElementById("measurement-form");
  const errorMessage = document.getElementById("form-error");
  const historyBody = document.getElementById("history-body");
  const historyEmpty = document.getElementById("history-empty");
  const toast = document.getElementById("toast");
  const exportButton = document.getElementById("export-button");
  const themeToggle = document.getElementById("theme-toggle");
  let measurements = loadMeasurements();
  let currentMeasurementId = null;
  let editingId = null;
  let toastTimer;

  function loadMeasurements() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(saved)) throw new Error("El historial guardado no tiene el formato esperado.");
      return saved.filter((item) => item && typeof item.id === "string" && fuels[item.fuelType]);
    } catch (error) {
      console.error("No se pudo leer el historial local.", error);
      return [];
    }
  }

  function persistMeasurements() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(measurements));
      return true;
    } catch (error) {
      console.error("No se pudo guardar el historial local.", error);
      showToast("No se pudo guardar. Revisa el almacenamiento del navegador.");
      return false;
    }
  }

  function numberFormat(value, maximumFractionDigits = 1) {
    return new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 0,
      maximumFractionDigits
    }).format(value);
  }

  function dateFormat(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Fecha no disponible";
    return new Intl.DateTimeFormat("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function getFormValues() {
    const fuelType = form.elements.fuelType.value;
    if ([form.elements.inletTemp, form.elements.exhaustTemp, form.elements.fuelFlow].some((field) => field.value.trim() === "")) {
      throw new Error("Completa todos los campos numéricos.");
    }
    const inletTemp = Number(form.elements.inletTemp.value);
    const exhaustTemp = Number(form.elements.exhaustTemp.value);
    const fuelFlow = Number(form.elements.fuelFlow.value);

    if (!fuels[fuelType]) throw new Error("Selecciona un tipo de combustible válido.");
    if (![inletTemp, exhaustTemp, fuelFlow].every(Number.isFinite)) {
      throw new Error("Completa todos los campos numéricos con valores válidos.");
    }
    if (inletTemp < 0 || exhaustTemp < 0 || fuelFlow < 0) {
      throw new Error("No se permiten valores negativos.");
    }
    if (inletTemp > 1000 || exhaustTemp > 1500 || fuelFlow > 1000000) {
      throw new Error("Revisa los valores: superan el rango permitido.");
    }
    if (fuelFlow === 0) throw new Error("El caudal de combustible debe ser mayor que cero.");

    return { fuelType, inletTemp, exhaustTemp, fuelFlow };
  }

  function calculate(values) {
    const fuel = fuels[values.fuelType];
    const fuelPower = values.fuelFlow * fuel.heatingValue;
    const temperatureDifference = Math.max(0, values.exhaustTemp - values.inletTemp);
    const exhaustLoss = Math.min(45, temperatureDifference * 0.04);
    const otherLosses = 8;
    const efficiency = Math.max(30, Math.min(95, 100 - exhaustLoss - otherLosses));
    const usefulPower = fuelPower * efficiency / 100;
    const specificConsumption = values.fuelFlow * 1000 / usefulPower;

    return {
      ...values,
      fuelPower,
      exhaustLoss,
      otherLosses,
      efficiency,
      usefulPower,
      specificConsumption
    };
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.add("visible");
  }

  function clearError() {
    errorMessage.textContent = "";
    errorMessage.classList.remove("visible");
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function setDonut(element, value, color) {
    const percentage = Math.max(0, Math.min(100, value));
    element.style.background = `conic-gradient(${color} 0 ${percentage}%, var(--donut-rest, #e8ecf2) ${percentage}% 100%)`;
  }

  function renderResults(measurement) {
    const hasResult = Boolean(measurement);
    document.getElementById("results-placeholder").style.display = hasResult ? "none" : "block";
    document.getElementById("efficiency-value").innerHTML = hasResult
      ? `${numberFormat(measurement.efficiency, 1)}<span>%</span>` : "—<span>%</span>";
    document.getElementById("specific-value").innerHTML = hasResult
      ? `${numberFormat(measurement.specificConsumption, 1)}<span>g/kWh</span>` : "—<span>g/kWh</span>";
    document.getElementById("power-value").innerHTML = hasResult
      ? `${numberFormat(measurement.usefulPower, 1)}<span>kW</span>` : "—<span>kW</span>";
    document.getElementById("efficiency-bar").style.width = hasResult ? `${measurement.efficiency}%` : "0";
    document.getElementById("efficiency-label").textContent = hasResult ? efficiencyLabel(measurement.efficiency) : "Pendiente";

    if (!hasResult) {
      renderAssistant(null);
      updateCharts(null);
      return;
    }
    renderAssistant(measurement);
    updateCharts(measurement);
  }

  function efficiencyLabel(value) {
    if (value >= 88) return "Muy eficiente";
    if (value >= 75) return "Eficiencia media";
    return "Por optimizar";
  }

  function renderAssistant(measurement) {
    const content = document.getElementById("assistant-content");
    if (!measurement) {
      content.innerHTML = `<div class="assistant-empty">
        <div class="assistant-orbit"><span>✦</span></div>
        <strong>Tu análisis inteligente aparecerá aquí</strong>
        <p>Realiza un cálculo para recibir una evaluación de la combustión y sugerencias de mejora.</p>
      </div>`;
      return;
    }

    let status;
    let color;
    let summary;
    let recommendation;
    if (measurement.efficiency >= 88) {
      status = "Mezcla en buen estado";
      color = "#27b78a";
      summary = "El rendimiento estimado es alto y la pérdida por gases de escape se mantiene controlada. La mezcla parece operar en un rango favorable.";
      recommendation = "Mantén la calibración actual. Verifica periódicamente el análisis de gases y el estado de los filtros para conservar este rendimiento.";
    } else if (measurement.efficiency >= 75) {
      status = "Mezcla mejorable";
      color = "#e9a23b";
      summary = "El equipo presenta margen de mejora. La temperatura de escape y las pérdidas estimadas sugieren revisar el ajuste de combustión.";
      recommendation = measurement.exhaustTemp > 250
        ? "Revisa el exceso de aire, la calibración del quemador y la transferencia del intercambiador. Reducir la temperatura de escape puede recuperar energía; realiza los ajustes gradualmente."
        : "Comprueba la relación aire-combustible, la limpieza de los quemadores y el mantenimiento del intercambiador para reducir pérdidas.";
    } else {
      status = "Requiere atención";
      color = "#df6b65";
      summary = "El rendimiento estimado está por debajo del rango recomendado. Conviene inspeccionar las condiciones de combustión y el equipo antes de ajustar la operación.";
      recommendation = "Verifica con un especialista la relación aire-combustible, la presión y atomización del combustible, posibles fugas y el ensuciamiento del intercambiador. No cambies parámetros de seguridad sin supervisión.";
    }
    if (measurement.exhaustTemp <= measurement.inletTemp) {
      summary += " La temperatura de escape no supera la de entrada; confirma que ambas mediciones y sus sensores sean correctos.";
    }

    content.innerHTML = `<div class="assistant-report">
      <div class="mix-status"><i class="mix-dot" style="background:${color}"></i><strong>${status}</strong><span>${numberFormat(measurement.efficiency, 1)}% eficiencia</span></div>
      <p>${summary}</p>
      <div class="recommendation"><strong>✦ Recomendación de optimización</strong>${recommendation}</div>
    </div>`;
  }

  function updateCharts(measurement) {
    const lossDonut = document.getElementById("loss-donut");
    const efficiencyDonut = document.getElementById("efficiency-donut");
    if (!measurement) {
      ["loss-chart-value", "loss-legend-value", "other-loss-value", "efficiency-chart-value", "efficiency-legend-value", "chart-total-loss-value"].forEach((id) => {
        document.getElementById(id).textContent = "—%";
      });
      setDonut(lossDonut, 0, "#f29a56");
      setDonut(efficiencyDonut, 0, "#5f91e7");
      return;
    }
    const totalLosses = 100 - measurement.efficiency;
    document.getElementById("loss-chart-value").textContent = `${numberFormat(measurement.exhaustLoss, 1)}%`;
    document.getElementById("loss-legend-value").textContent = `${numberFormat(measurement.exhaustLoss, 1)}%`;
    document.getElementById("other-loss-value").textContent = `${numberFormat(100 - measurement.exhaustLoss, 1)}%`;
    document.getElementById("efficiency-chart-value").textContent = `${numberFormat(measurement.efficiency, 1)}%`;
    document.getElementById("efficiency-legend-value").textContent = `${numberFormat(measurement.efficiency, 1)}%`;
    document.getElementById("chart-total-loss-value").textContent = `${numberFormat(totalLosses, 1)}%`;
    setDonut(lossDonut, measurement.exhaustLoss, "#f29a56");
    setDonut(efficiencyDonut, measurement.efficiency, "#5f91e7");
  }

  function updateSummary() {
    const latest = measurements.find((item) => item.id === currentMeasurementId) || measurements[0];
    document.getElementById("summary-count").textContent = numberFormat(measurements.length, 0);
    document.getElementById("summary-efficiency").innerHTML = latest
      ? `${numberFormat(latest.efficiency, 1)}<small>%</small>` : "—<small>%</small>";
    document.getElementById("summary-power").innerHTML = latest
      ? `${numberFormat(latest.usefulPower, 1)}<small>kW</small>` : "—<small>kW</small>";
    document.getElementById("summary-fuel").textContent = latest ? fuels[latest.fuelType].name : "—";
    document.getElementById("summary-efficiency-note").textContent = latest
      ? efficiencyLabel(latest.efficiency) : "Sin mediciones";
  }

  function makeCell(text, className = "") {
    const cell = document.createElement("td");
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  }

  function makeFuelCell(fuelName) {
    const cell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "fuel-chip";
    badge.textContent = fuelName;
    cell.append(badge);
    return cell;
  }

  function renderHistory() {
    historyBody.replaceChildren();
    const sorted = [...measurements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    historyEmpty.style.display = sorted.length ? "none" : "flex";
    document.getElementById("history-count").textContent = `${sorted.length} ${sorted.length === 1 ? "registro" : "registros"}`;

    sorted.forEach((measurement) => {
      const row = document.createElement("tr");
      row.append(
        makeCell(dateFormat(measurement.createdAt)),
        makeFuelCell(fuels[measurement.fuelType].name),
        makeCell(`${numberFormat(measurement.fuelFlow, 2)} kg/h`),
        makeCell(`${numberFormat(measurement.inletTemp, 1)} °C`),
        makeCell(`${numberFormat(measurement.exhaustTemp, 1)} °C`),
        makeCell(`${numberFormat(measurement.efficiency, 1)}%`, "efficiency-chip"),
        makeCell(`${numberFormat(measurement.usefulPower, 1)} kW`)
      );
      const actions = document.createElement("td");
      const actionWrap = document.createElement("div");
      actionWrap.className = "row-actions";
      const editButton = document.createElement("button");
      editButton.className = "row-action";
      editButton.type = "button";
      editButton.setAttribute("aria-label", "Editar medición");
      editButton.title = "Editar";
      editButton.textContent = "✎";
      editButton.addEventListener("click", () => editMeasurement(measurement.id));
      const deleteButton = document.createElement("button");
      deleteButton.className = "row-action delete";
      deleteButton.type = "button";
      deleteButton.setAttribute("aria-label", "Eliminar medición");
      deleteButton.title = "Eliminar";
      deleteButton.textContent = "×";
      deleteButton.addEventListener("click", () => deleteMeasurement(measurement.id));
      actionWrap.append(editButton, deleteButton);
      actions.append(actionWrap);
      row.append(actions);
      historyBody.append(row);
    });
    updateSummary();
  }

  function updateSelectedMeasurement() {
    const selected = measurements.find((item) => item.id === currentMeasurementId) || measurements[0] || null;
    currentMeasurementId = selected ? selected.id : null;
    renderResults(selected);
    updateSummary();
  }

  function editMeasurement(id) {
    const measurement = measurements.find((item) => item.id === id);
    if (!measurement) return;
    editingId = id;
    form.elements.fuelType.value = measurement.fuelType;
    form.elements.inletTemp.value = measurement.inletTemp;
    form.elements.exhaustTemp.value = measurement.exhaustTemp;
    form.elements.fuelFlow.value = measurement.fuelFlow;
    form.querySelector(".calculate-button span:first-child").textContent = "Actualizar medición";
    let cancelButton = document.getElementById("cancel-edit");
    if (!cancelButton) {
      cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.id = "cancel-edit";
      cancelButton.className = "button button-outline";
      cancelButton.textContent = "Cancelar edición";
      cancelButton.addEventListener("click", cancelEdit);
      form.append(cancelButton);
    }
    clearError();
    document.getElementById("panel").scrollIntoView({ behavior: "smooth" });
    showToast("Medición cargada. Modifica los datos y actualiza.");
  }

  function cancelEdit() {
    editingId = null;
    form.reset();
    form.querySelector(".calculate-button span:first-child").textContent = "Calcular rendimiento y analizar";
    document.getElementById("cancel-edit")?.remove();
    clearError();
  }

  function deleteMeasurement(id) {
    const removedCurrent = currentMeasurementId === id;
    const previousMeasurements = measurements;
    measurements = measurements.filter((item) => item.id !== id);
    if (!persistMeasurements()) {
      measurements = previousMeasurements;
      return;
    }
    if (editingId === id) cancelEdit();
    if (removedCurrent) currentMeasurementId = measurements[0]?.id || null;
    renderHistory();
    updateSelectedMeasurement();
    showToast("Medición eliminada.");
  }

 /**
 * Genera un identificador único combinado para nuevas mediciones térmicas.
 */
function generateMeasurementId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Crea un nuevo registro o actualiza uno existente en el arreglo global de mediciones.
 */
function upsertMeasurementRecord(calculatedData, timestamp) {
  if (editingId) {
    const targetIndex = measurements.findIndex((record) => record.id === editingId);
    if (targetIndex < 0) {
      throw new Error("No se encontró la medición que intentas editar.");
    }
    measurements[targetIndex] = {
      ...calculatedData,
      id: editingId,
      createdAt: measurements[targetIndex].createdAt,
      updatedAt: timestamp
    };
    currentMeasurementId = editingId;
    return;
  }

  const newRecord = {
    ...calculatedData,
    id: generateMeasurementId(),
    createdAt: timestamp
  };
  measurements.push(newRecord);
  currentMeasurementId = newRecord.id;
}

/**
 * Actualiza los paneles visuales, restablece el estado del formulario y notifica al usuario.
 */
function syncInterfaceAfterSubmit(wasEditing) {
  const activeMeasurement = measurements.find((record) => record.id === currentMeasurementId);
  renderResults(activeMeasurement);
  renderHistory();

  if (wasEditing) {
    cancelEdit();
    showToast("Medición actualizada correctamente.");
  } else {
    form.reset();
    showToast("Cálculo realizado y guardado en el historial.");
  }

  const resultsSection = document.getElementById("resultados");
  if (resultsSection) {
    resultsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/**
 * Orquesta el envío del formulario: valida, calcula, persiste y actualiza la vista.
 */
function submitMeasurement(event) {
  event.preventDefault();
  clearError();

  try {
    const calculatedData = calculate(getFormValues());
    const timestamp = new Date().toISOString();
    const measurementsSnapshot = measurements.map((record) => ({ ...record }));
    const wasEditing = Boolean(editingId);

    upsertMeasurementRecord(calculatedData, timestamp);

    if (!persistMeasurements()) {
      measurements = measurementsSnapshot;
      return;
    }

    syncInterfaceAfterSubmit(wasEditing);
  } catch (error) {
    const errorMessage = error instanceof Error
      ? error.message
      : "No se pudo calcular. Revisa los datos ingresados.";
    showError(errorMessage);
  }
}

  function csvEscape(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
  }

  function exportReport() {
    if (!measurements.length) {
      showToast("Realiza al menos un cálculo antes de exportar.");
      return;
    }
    const headers = ["Fecha y hora", "Tipo de combustible", "Caudal (kg/h)", "Temperatura de entrada (°C)", "Temperatura de escape (°C)", "Rendimiento térmico (%)", "Consumo específico (g/kWh)", "Potencia térmica útil (kW)", "Pérdida por escape (%)"];
    const rows = [...measurements]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((item) => [
        dateFormat(item.createdAt),
        fuels[item.fuelType].name,
        item.fuelFlow,
        item.inletTemp,
        item.exhaustTemp,
        numberFormat(item.efficiency, 2),
        numberFormat(item.specificConsumption, 2),
        numberFormat(item.usefulPower, 2),
        numberFormat(item.exhaustLoss, 2)
      ]);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvEscape).join(";")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reporte-thermowise-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Reporte CSV exportado.");
  }

  function applyTheme(theme) {
    const dark = theme === "dark";
    document.body.classList.toggle("dark-theme", dark);
    themeToggle.querySelector(".theme-icon").textContent = dark ? "☀" : "☾";
    themeToggle.querySelector(".theme-text").textContent = dark ? "Tema claro" : "Tema oscuro";
    themeToggle.setAttribute("aria-label", dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
    document.querySelector('meta[name="theme-color"]').setAttribute("content", dark ? "#0c1425" : "#f5f7fb");
  }

  form.addEventListener("submit", submitMeasurement);
  exportButton.addEventListener("click", exportReport);
  themeToggle.addEventListener("click", () => {
    const theme = document.body.classList.contains("dark-theme") ? "light" : "dark";
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      console.error("No se pudo guardar la preferencia de tema.", error);
    }
  });

  document.getElementById("today-label").textContent = new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date());
  try {
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
  } catch (error) {
    console.error("No se pudo leer la preferencia de tema.", error);
    applyTheme("light");
  }
  renderHistory();
  currentMeasurementId = measurements[0]?.id || null;
  updateSelectedMeasurement();
})();