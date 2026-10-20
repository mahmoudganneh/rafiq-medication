(() => {
  "use strict";

  const STORAGE_KEY = "rafiqMedicationData_v1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const dateKey = (date = new Date()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  const timeLabel = (time) => {
    if (!time) return "";
    const [hours, minutes] = time.split(":").map(Number);
    const suffix = hours >= 12 ? "م" : "ص";
    const h = hours % 12 || 12;
    return `${h}:${String(minutes).padStart(2, "0")} ${suffix}`;
  };
  const safeText = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

  const demoData = () => ({
    medicines: [],
    events: [],
    reminderLog: [],
    settings: { soundEnabled: false, snoozeMinutes: 10, snoozedReminders: {} },
    version: 1
  });

  let data = loadData();
  let audioContext = null;
  let reminderTimer = null;
  let activeReminderKey = null;
  let editingMedicineId = null;
  let toastTimer = null;

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return demoData();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.medicines) || !Array.isArray(parsed.events)) return demoData();
      parsed.reminderLog = Array.isArray(parsed.reminderLog) ? parsed.reminderLog : [];
      parsed.settings = parsed.settings || { soundEnabled: false, snoozeMinutes: 10 };
      return parsed;
    } catch (error) {
      console.warn("Unable to read local data", error);
      return demoData();
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      showToast("تعذر حفظ البيانات. قد تكون مساحة التخزين ممتلئة.");
      console.error(error);
      return false;
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
  }

  function getMedicine(id) {
    return data.medicines.find(item => item.id === id);
  }

  function getDoseStatus(medicineId, date, time) {
    const event = data.events.find(e => e.medicineId === medicineId && e.date === date && e.time === time);
    return event || null;
  }

  function statusInfo(event) {
    if (!event) return { label: "بانتظار التأكيد", cls: "pending" };
    if (event.status === "taken") return { label: "تم تأكيد التناول", cls: "taken" };
    if (event.status === "unconfirmed") return { label: "لم يتم التأكيد", cls: "unconfirmed" };
    if (event.status === "snoozed") return { label: "تم تأجيل التذكير", cls: "pending" };
    return { label: "بانتظار التأكيد", cls: "pending" };
  }

  function todayDoses() {
    const today = dateKey();
    return data.medicines.flatMap(med => med.times.map(time => ({
      medicine: med, time, date: today, event: getDoseStatus(med.id, today, time)
    }))).sort((a, b) => a.time.localeCompare(b.time));
  }

  function renderToday() {
    const list = $("#todayList");
    const doses = todayDoses();
    list.innerHTML = "";
    $("#emptyToday").hidden = doses.length > 0;
    list.hidden = doses.length === 0;
    $("#doseCount").textContent = String(doses.length);
    const taken = doses.filter(d => d.event?.status === "taken").length;
    $("#doseSummary").textContent = `${taken} من ${doses.length} تم تأكيدها`;
    doses.forEach(dose => {
      const status = statusInfo(dose.event);
      const card = document.createElement("article");
      card.className = "dose-card";
      const canConfirm = dose.event?.status !== "taken";
      const canUnconfirm = dose.event?.status !== "unconfirmed";
      card.innerHTML = `
        <div>
          <div class="dose-main">
            <div class="pill-icon" aria-hidden="true">💊</div>
            <div>
              <p class="dose-name">${safeText(dose.medicine.name)}</p>
              <p class="dose-detail">${safeText(dose.medicine.dose)}${dose.medicine.notes ? " · " + safeText(dose.medicine.notes) : ""}</p>
              <span class="status-chip status-${status.cls}">${status.label}</span>
            </div>
          </div>
          <div class="dose-actions">
            <button class="button button-primary" type="button" data-action="taken" data-med="${safeText(dose.medicine.id)}" data-time="${dose.time}" ${canConfirm ? "" : "disabled"}>✓ تم تناول الدواء</button>
            <button class="button button-secondary" type="button" data-action="unconfirmed" data-med="${safeText(dose.medicine.id)}" data-time="${dose.time}" ${canUnconfirm ? "" : "disabled"}>لم يتم التأكيد</button>
            <button class="button button-secondary" type="button" data-action="snooze" data-med="${safeText(dose.medicine.id)}" data-time="${dose.time}">ذكّرني لاحقاً</button>
          </div>
        </div>
        <div class="dose-card-side"><span class="dose-time">${timeLabel(dose.time)}</span></div>`;
      list.appendChild(card);
    });
  }

  function renderMedicines() {
    const list = $("#medicineList");
    list.innerHTML = "";
    $("#emptyMedicines").hidden = data.medicines.length > 0;
    list.hidden = data.medicines.length === 0;
    data.medicines.forEach(med => {
      const card = document.createElement("article");
      card.className = "medicine-card";
      card.innerHTML = `
        <div class="medicine-card-head"><div><p class="eyebrow">دواء مسجل</p><h3>${safeText(med.name)}</h3></div><span aria-hidden="true">💊</span></div>
        <p><strong>الجرعة:</strong> ${safeText(med.dose)}</p>
        ${med.notes ? `<p><strong>ملاحظات:</strong> ${safeText(med.notes)}</p>` : ""}
        <div class="medicine-times" aria-label="مواعيد التذكير">${med.times.map(t => `<span class="time-tag">${timeLabel(t)}</span>`).join("")}</div>
        <div class="card-actions">
          <button class="button button-secondary" type="button" data-edit="${safeText(med.id)}">تعديل</button>
          <button class="button button-danger" type="button" data-delete="${safeText(med.id)}">حذف</button>
        </div>`;
      list.appendChild(card);
    });
  }

  function renderHistory() {
    const tbody = $("#historyTable");
    tbody.innerHTML = "";
    const rows = [...data.events].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    $("#emptyHistory").hidden = rows.length > 0;
    $(".table-wrap").hidden = rows.length === 0;
    rows.forEach(event => {
      const med = getMedicine(event.medicineId);
      const info = statusInfo(event);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${safeText(event.date)}</td><td>${safeText(event.medicineName || med?.name || "دواء محذوف")}</td><td>${timeLabel(event.time)}</td><td><span class="status-chip status-${info.cls}">${info.label}</span></td><td>${safeText(event.recordedAt ? new Date(event.recordedAt).toLocaleTimeString("ar", {hour: "2-digit", minute: "2-digit"}) : "—")}</td>`;
      tbody.appendChild(tr);
    });
  }

  function renderCaregiver() {
    const doses = todayDoses();
    $("#careTaken").textContent = String(doses.filter(d => d.event?.status === "taken").length);
    $("#carePending").textContent = String(doses.filter(d => !d.event || d.event.status === "snoozed").length);
    $("#careUnconfirmed").textContent = String(doses.filter(d => d.event?.status === "unconfirmed").length);
  }

  function renderAll() {
    renderToday();
    renderMedicines();
    renderHistory();
    renderCaregiver();
    $("#todayLabel").textContent = new Date().toLocaleDateString("ar", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    $("#soundToggle").setAttribute("aria-pressed", String(Boolean(data.settings.soundEnabled)));
    $("#soundToggle").textContent = data.settings.soundEnabled ? "🔔 الصوت مفعّل" : "🔔 تفعيل الصوت";
  }

  function switchView(name) {
    $$(".tab").forEach(tab => {
      const active = tab.dataset.view === name;
      tab.classList.toggle("active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    $$(".view").forEach(view => {
      const active = view.id === `view-${name}`;
      view.hidden = !active;
      view.classList.toggle("active", active);
    });
  }

  function addTimeRow(value = "") {
    const row = document.createElement("div");
    row.className = "time-row";
    row.innerHTML = `<label class="sr-only">موعد التذكير</label><input type="time" required aria-label="موعد التذكير" value="${safeText(value)}"><button class="remove-time" type="button" aria-label="حذف هذا الموعد">−</button>`;
    $(".remove-time", row).addEventListener("click", () => {
      if ($$(".time-row", $("#timesList")).length <= 1) {
        showToast("يجب إدخال موعد واحد على الأقل.");
        return;
      }
      row.remove();
    });
    $("#timesList").appendChild(row);
  }

  function openMedicineDialog(medicine = null) {
    editingMedicineId = medicine?.id || null;
    $("#medicineId").value = editingMedicineId || "";
    $("#dialogTitle").textContent = medicine ? "تعديل دواء" : "إضافة دواء";
    $("#medicineName").value = medicine?.name || "";
    $("#medicineDose").value = medicine?.dose || "";
    $("#medicineNotes").value = medicine?.notes || "";
    $("#timesList").innerHTML = "";
    (medicine?.times || [""]).forEach(time => addTimeRow(time));
    $("#formError").hidden = true;
    $("#medicineDialog").showModal();
    $("#medicineName").focus();
  }

  function closeMedicineDialog() {
    $("#medicineDialog").close();
  }

  function saveMedicine(event) {
    event.preventDefault();
    const name = $("#medicineName").value.trim();
    const dose = $("#medicineDose").value.trim();
    const notes = $("#medicineNotes").value.trim();
    const times = $$(".time-row input", $("#timesList")).map(input => input.value).filter(Boolean);
    const error = $("#formError");
    if (!name || !dose || !times.length) {
      error.textContent = "يرجى إدخال اسم الدواء والجرعة المسجلة وموعد واحد على الأقل.";
      error.hidden = false;
      return;
    }
    if (new Set(times).size !== times.length) {
      error.textContent = "يوجد موعد مكرر. يرجى تعديل المواعيد لتكون مختلفة.";
      error.hidden = false;
      return;
    }
    const med = { id: editingMedicineId || uid(), name, dose, notes, times: [...times].sort(), updatedAt: new Date().toISOString() };
    if (editingMedicineId) {
      const index = data.medicines.findIndex(m => m.id === editingMedicineId);
      if (index >= 0) data.medicines[index] = med;
      // Keep historical records, including the medicine name at time of recording.
    } else {
      data.medicines.push({ ...med, createdAt: new Date().toISOString() });
    }
    if (saveData()) {
      closeMedicineDialog();
      renderAll();
      showToast(editingMedicineId ? "تم تحديث بيانات الدواء." : "تمت إضافة الدواء.");
    }
  }

  function recordStatus(medicineId, time, status) {
    const today = dateKey();
    const med = getMedicine(medicineId);
    if (!med) return;
    let event = getDoseStatus(medicineId, today, time);
    if (!event) {
      event = { id: uid(), medicineId, medicineName: med.name, date: today, time, status, recordedAt: new Date().toISOString() };
      data.events.push(event);
    } else {
      event.status = status;
      event.recordedAt = new Date().toISOString();
      event.medicineName = med.name;
    }
    if (saveData()) {
      renderAll();
      const msg = status === "taken" ? "تم تسجيل تأكيد تناول الدواء." :
        status === "unconfirmed" ? "تم تسجيل أن التناول لم يتم تأكيده." : "تم تأجيل التذكير محلياً.";
      showToast(msg);
      if (activeReminderKey === `${medicineId}|${today}|${time}` && status !== "snoozed") stopAlarm();
    }
  }

  function deleteMedicine(id) {
    const med = getMedicine(id);
    if (!med) return;
    if (!confirm(`هل تريد حذف "${med.name}" من قائمة الأدوية؟ ستبقى السجلات التاريخية محفوظة.`)) return;
    data.medicines = data.medicines.filter(m => m.id !== id);
    saveData();
    renderAll();
    showToast("تم حذف الدواء من القائمة. السجل التاريخي محفوظ.");
  }

  function enableAudio() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      showToast("الصوت غير مدعوم في هذا المتصفح.");
      return false;
    }
    try {
      audioContext = audioContext || new AudioCtx();
      if (audioContext.state === "suspended") audioContext.resume();
      data.settings.soundEnabled = true;
      saveData();
      renderAll();
      beep();
      showToast("تم تفعيل الصوت. اترك صفحة النظام مفتوحة لتلقي التنبيهات.");
      return true;
    } catch (error) {
      showToast("لم يتم تفعيل الصوت. حاول مرة أخرى.");
      return false;
    }
  }

  function beep() {
    if (!data.settings.soundEnabled || !audioContext || audioContext.state !== "running") return;
    const start = audioContext.currentTime;
    [0, 0.35, 0.7].forEach(offset => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.24);
    });
  }

  function stopAlarm() {
    if (reminderTimer) clearInterval(reminderTimer);
    reminderTimer = null;
    activeReminderKey = null;
    $("#alertPanel").hidden = true;
  }

  function triggerReminder(dose) {
    const key = `${dose.medicine.id}|${dose.date}|${dose.time}`;
    if (activeReminderKey === key) return;
    activeReminderKey = key;
    $("#alertTitle").textContent = "حان موعد التذكير";
    $("#alertText").textContent = `${dose.medicine.name} — ${dose.medicine.dose}. راجع تعليماتك المسجلة، ثم حدّد الحالة.`;
    $("#alertPanel").hidden = false;
    beep();
    if ("vibrate" in navigator) navigator.vibrate?.([180, 90, 180]);
    showToast(`تذكير: حان موعد ${dose.medicine.name}.`);
    $("#alertPanel").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function checkReminders() {
    if (document.hidden) return;
    const now = new Date();
    const today = dateKey(now);
    const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const snoozed = data.settings.snoozedReminders || {};
    for (const [key, dueAt] of Object.entries(snoozed)) {
      if (Number(dueAt) <= now.getTime()) {
        delete snoozed[key];
        const [medicineId, date, time] = key.split("|");
        const med = getMedicine(medicineId);
        if (date === today && med && !getDoseStatus(medicineId, today, time)) {
          saveData();
          triggerReminder({ medicine: med, date, time });
          return;
        }
      }
    }
    for (const dose of todayDoses()) {
      const key = `${dose.medicine.id}|${today}|${dose.time}`;
      if (dose.time === current && !dose.event && !data.reminderLog.includes(key)) {
        data.reminderLog.push(key);
        saveData();
        triggerReminder(dose);
        break;
      }
    }
  }

  function exportCsv() {
    const rows = [["Date", "Medicine", "Scheduled time", "Status", "Recorded at"]];
    [...data.events].sort((a,b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).forEach(e => {
      rows.push([e.date, e.medicineName || getMedicine(e.medicineId)?.name || "Deleted medicine", e.time, e.status, e.recordedAt || ""]);
    });
    const csv = "\uFEFF" + rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    downloadBlob(csv, `rafiq-dose-history-${dateKey()}.csv`, "text/csv;charset=utf-8");
  }

  function exportBackup() {
    const content = JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2);
    downloadBlob(content, `rafiq-backup-${dateKey()}.json`, "application/json");
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function resetDemo() {
    if (!confirm("سيتم حذف الأدوية وسجل الجرعات من هذا المتصفح. هل تريد المتابعة؟")) return;
    data = demoData();
    saveData();
    stopAlarm();
    renderAll();
    showToast("تم حذف بيانات التجربة من هذا المتصفح.");
  }

  function bindEvents() {
    $$(".tab").forEach(tab => tab.addEventListener("click", () => switchView(tab.dataset.view)));
    $$("[data-open-add]").forEach(button => button.addEventListener("click", () => openMedicineDialog()));
    $("#goAddMedicine").addEventListener("click", () => openMedicineDialog());
    $("#closeDialog").addEventListener("click", closeMedicineDialog);
    $("#cancelDialog").addEventListener("click", closeMedicineDialog);
    $("#addTime").addEventListener("click", () => addTimeRow());
    $("#medicineForm").addEventListener("submit", saveMedicine);
    $("#soundToggle").addEventListener("click", () => {
      if (data.settings.soundEnabled) {
        data.settings.soundEnabled = false;
        saveData();
        renderAll();
        showToast("تم إيقاف صوت التنبيه.");
      } else enableAudio();
    });
    $("#dismissAlert").addEventListener("click", () => {
      stopAlarm();
      showToast("تم إيقاف صوت التذكير. حدّد حالة الجرعة في الجدول عند الحاجة.");
    });
    $("#todayList").addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (action === "snooze") {
        const med = getMedicine(button.dataset.med);
        if (!med) return;
        const key = `${button.dataset.med}|${dateKey()}|${button.dataset.time}`;
        data.settings.snoozedReminders = data.settings.snoozedReminders || {};
        data.settings.snoozedReminders[key] = Date.now() + (Number(data.settings.snoozeMinutes) || 10) * 60 * 1000;
        saveData();
        stopAlarm();
        showToast("تم تأجيل التذكير 10 دقائق. سيبقى الموعد بانتظار التأكيد.");
        return;
      }
      recordStatus(button.dataset.med, button.dataset.time, action);
    });
    $("#medicineList").addEventListener("click", event => {
      const edit = event.target.closest("[data-edit]");
      const del = event.target.closest("[data-delete]");
      if (edit) openMedicineDialog(getMedicine(edit.dataset.edit));
      if (del) deleteMedicine(del.dataset.delete);
    });
    $("#exportHistory").addEventListener("click", exportCsv);
    $("#backupData").addEventListener("click", exportBackup);
    $("#resetDemo").addEventListener("click", resetDemo);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkReminders(); });
    window.addEventListener("focus", checkReminders);
  }

  bindEvents();
  renderAll();
  checkReminders();
  reminderTimer = setInterval(checkReminders, 15000);
})();