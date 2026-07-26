(() => {
  const STORAGE_KEY = "finish-line-friend-v2";
  const MAX_FOCUS_FRACTION = 0.85;

  const DAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const DAY_ALIASES = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
  };

  const DIFFICULTY = {
    easy: { id: "easy", label: "easy", load: 1 },
    medium: { id: "medium", label: "medium", load: 2 },
    hard: { id: "hard", label: "hard", load: 3 },
  };

  const state = {
    profile: null,
    assignments: [],
    plan: [],
    upcoming: [],
    /** Completed plan sessions for today (keeps multi-session checkboxes checked). */
    completedSessions: [],
  };

  const els = {
    setupScreen: document.getElementById("setup-screen"),
    appShell: document.getElementById("app-shell"),
    setupForm: document.getElementById("setup-form"),
    classRows: document.getElementById("class-rows"),
    addClassBtn: document.getElementById("add-class-btn"),
    setupError: document.getElementById("setup-error"),
    addHomeworkBtn: document.getElementById("add-homework-btn"),
    editSetupBtn: document.getElementById("edit-setup-btn"),
    hwModal: document.getElementById("hw-modal"),
    hwForm: document.getElementById("hw-form"),
    hwError: document.getElementById("hw-error"),
    messages: document.getElementById("messages"),
    form: document.getElementById("chat-form"),
    input: document.getElementById("chat-input"),
    planList: document.getElementById("plan-list"),
    emptyPlan: document.getElementById("empty-plan"),
    backlog: document.getElementById("backlog"),
    backlogList: document.getElementById("backlog-list"),
    classProgress: document.getElementById("class-progress"),
    musicToggle: document.getElementById("music-toggle"),
    musicVolume: document.getElementById("music-volume"),
  };

  const focusMusic = {
    ctx: null,
    nodes: [],
    playing: false,
    volume: 0.35,
  };

  function uid(prefix = "a") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function save() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profile: state.profile,
        assignments: state.assignments,
        completedSessions: state.completedSessions,
      })
    );
  }

  function load() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) raw = localStorage.getItem("finish-line-friend-v1");
      if (!raw) return;
      const data = JSON.parse(raw);
      state.profile = data.profile ? normalizeProfile(data.profile) : null;
      state.assignments = Array.isArray(data.assignments)
        ? data.assignments.map(sanitizeAssignment)
        : [];
      state.completedSessions = Array.isArray(data.completedSessions)
        ? data.completedSessions
        : [];
      pruneCompletedSessions();
    } catch {
      /* ignore */
    }
  }

  function pruneCompletedSessions() {
    const today = isoDate(startOfToday());
    state.completedSessions = (state.completedSessions || []).filter(
      (s) => s && s.date === today
    );
  }

  function completedSessionsToday() {
    pruneCompletedSessions();
    return state.completedSessions;
  }

  function timeInputToMin(value) {
    if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  }

  function minToTimeInput(total) {
    if (!Number.isFinite(total)) return "";
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function classAliases(name) {
    const lower = name.toLowerCase();
    const parts = lower.split(/\s+/).filter((w) => w.length > 2);
    return [...new Set([lower, ...parts])];
  }

  function defaultSemesterBounds(fromDate = startOfToday()) {
    const y = fromDate.getFullYear();
    const m = fromDate.getMonth();
    // Aug–Dec → fall; otherwise spring (Jan–Jun).
    if (m >= 7) {
      return { start: `${y}-08-15`, end: `${y}-12-20` };
    }
    return { start: `${y}-01-05`, end: `${y}-06-05` };
  }

  function normalizeProfile(p) {
    const classes = (p.classes || []).map((c, i) => ({
      id: c.id || uid("c"),
      name: c.name,
      period: Number.isFinite(c.period) ? c.period : i + 1,
      teacher: c.teacher || "",
      aliases: c.aliases?.length ? c.aliases : classAliases(c.name),
    }));

    let homeworkBeginMin = p.homeworkBeginMin;
    let homeworkFinishMin = p.homeworkFinishMin;
    let schoolEndMin = p.schoolEndMin;

    if (homeworkBeginMin == null && p.availability) {
      const weekday = p.availability[1] || p.availability["1"];
      if (weekday && !weekday.off) {
        homeworkBeginMin = weekday.startMin;
        homeworkFinishMin = weekday.endMin;
        schoolEndMin = Math.max(0, (weekday.startMin || 15 * 60) - 30);
      }
    }

    homeworkBeginMin = homeworkBeginMin ?? 15 * 60 + 30;
    homeworkFinishMin = homeworkFinishMin ?? 21 * 60;
    schoolEndMin = schoolEndMin ?? 15 * 60;

    const commitmentsNote =
      typeof p.commitmentsNote === "string"
        ? p.commitmentsNote
        : Array.isArray(p.commitments)
          ? p.commitments
              .map(
                (c) =>
                  `${DAY_NAMES[c.day] || ""} ${formatClock(c.startMin)}–${formatClock(c.endMin)} ${c.label || ""}`.trim()
              )
              .join("; ")
          : p.commitments || "";

    const commitmentBlocks = Array.isArray(p.commitmentBlocks)
      ? p.commitmentBlocks
      : parseCommitmentLine(String(commitmentsNote || ""));

    const defaults = defaultSemesterBounds();
    let semesterStart =
      typeof p.semesterStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.semesterStart)
        ? p.semesterStart
        : defaults.start;
    let semesterEnd =
      typeof p.semesterEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.semesterEnd)
        ? p.semesterEnd
        : defaults.end;
    if (semesterEnd < semesterStart) {
      semesterStart = defaults.start;
      semesterEnd = defaults.end;
    }

    return {
      name: p.name || "Student",
      classes,
      schoolEndMin,
      homeworkBeginMin,
      homeworkFinishMin,
      commitmentsNote,
      commitmentBlocks,
      semesterStart,
      semesterEnd,
      blockMinutes: p.blockMinutes || 45,
      breakMinutes: p.breakMinutes || 10,
    };
  }

  function sanitizeAssignment(a) {
    const minutes = Number(a.minutes) > 0 ? Number(a.minutes) : 30;
    let remaining = Number.isFinite(a.remainingMinutes)
      ? a.remainingMinutes
      : minutes;
    if (a.done) remaining = 0;
    const today = isoDate(startOfToday());
    return {
      id: a.id || uid(),
      classId: a.classId || "",
      title: String(a.title || "Assignment").replace(/\s+/g, " ").trim(),
      assignedDate: a.assignedDate || a.dueDate || isoDate(startOfToday()),
      dueDate: a.dueDate || isoDate(addDays(startOfToday(), 2)),
      dueTimeMin: Number.isFinite(a.dueTimeMin) ? a.dueTimeMin : null,
      minutes,
      remainingMinutes: Math.max(0, Math.min(minutes, remaining)),
      difficulty: DIFFICULTY[a.difficulty] ? a.difficulty : "medium",
      notes: a.notes || "",
      done: Boolean(a.done),
      progressDate: a.progressDate === today ? today : today,
      completedTodayMinutes:
        a.progressDate === today && Number.isFinite(a.completedTodayMinutes)
          ? Math.max(0, a.completedTodayMinutes)
          : 0,
    };
  }

  function remainingOf(a) {
    if (!a || a.done) return 0;
    if (Number.isFinite(a.remainingMinutes)) return Math.max(0, a.remainingMinutes);
    return Math.max(0, a.minutes || 0);
  }

  function ensureProgressDay(a) {
    const today = isoDate(startOfToday());
    if (a.progressDate !== today) {
      a.progressDate = today;
      a.completedTodayMinutes = 0;
    }
  }

  function classById(id) {
    return state.profile?.classes?.find((c) => c.id === id) || null;
  }

  function findClassInText(text) {
    if (!state.profile?.classes?.length) return null;
    const lower = text.toLowerCase();
    let best = null;
    let bestLen = 0;
    for (const cls of state.profile.classes) {
      const names = [cls.name, ...(cls.aliases || [])];
      for (const alias of names) {
        const a = alias.toLowerCase();
        if (a && lower.includes(a) && a.length > bestLen) {
          best = cls;
          bestLen = a.length;
        }
      }
    }
    return best;
  }

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function isoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseTimeToMin(text) {
    const t = text.toLowerCase().trim();
    const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const ap = m[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (!ap && h <= 12 && h < 7) h += 12;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function formatClock(totalMin) {
    const h24 = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    const h12 = ((h24 + 11) % 12) + 1;
    const ampm = h24 >= 12 ? "PM" : "AM";
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  function formatTimeRange(start, end) {
    const startH = Math.floor(start / 60);
    const endH = Math.floor(end / 60);
    const startM = start % 60;
    const endM = end % 60;
    const endAmpm = endH >= 12 ? "PM" : "AM";
    const start12 = ((startH + 11) % 12) + 1;
    const end12 = ((endH + 11) % 12) + 1;
    const same = (startH >= 12) === (endH >= 12);
    if (same) {
      return `${start12}:${String(startM).padStart(2, "0")}–${end12}:${String(endM).padStart(2, "0")} ${endAmpm}`;
    }
    const startAmpm = startH >= 12 ? "PM" : "AM";
    return `${start12}:${String(startM).padStart(2, "0")} ${startAmpm}–${end12}:${String(endM).padStart(2, "0")} ${endAmpm}`;
  }

  function parseDate(text) {
    const lower = text.toLowerCase().trim();
    const today = startOfToday();
    if (/\btoday\b/.test(lower)) return isoDate(today);
    if (/\btomorrow\b/.test(lower)) return isoDate(addDays(today, 1));
    const inDays = lower.match(/\bin\s+(\d+)\s+days?\b/);
    if (inDays) return isoDate(addDays(today, Number(inDays[1])));

    const dayNames = Object.entries(DAY_ALIASES).filter(([name]) => name.length >= 3);
    dayNames.sort((a, b) => b[0].length - a[0].length);
    for (const [name, i] of dayNames) {
      const re = new RegExp(`\\b(?:due\\s+)?(?:(?:on|by)\\s+)?(?:next\\s+)?${name}\\b`);
      if (!re.test(lower)) continue;
      const current = today.getDay();
      let delta = (i - current + 7) % 7;
      if (/\bnext\s+/.test(lower) && delta === 0) delta = 7;
      return isoDate(addDays(today, delta));
    }

    const numeric = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (numeric) {
      const month = Number(numeric[1]) - 1;
      const day = Number(numeric[2]);
      let year = numeric[3] ? Number(numeric[3]) : today.getFullYear();
      if (year < 100) year += 2000;
      const d = new Date(year, month, day);
      if (!Number.isNaN(d.getTime())) {
        if (!numeric[3] && d < today) d.setFullYear(d.getFullYear() + 1);
        return isoDate(d);
      }
    }
    return null;
  }

  function formatDue(iso) {
    const d = new Date(`${iso}T12:00:00`);
    const today = startOfToday();
    const diff = Math.round((d - today) / 86400000);
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function nowMinutes() {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  }

  function roundUp(min, step = 5) {
    return Math.ceil(min / step) * step;
  }

  function daysUntilDue(iso) {
    const d = new Date(`${iso}T12:00:00`);
    return Math.round((d - startOfToday()) / 86400000);
  }

  function openAssignments() {
    return state.assignments.filter((a) => !a.done);
  }

  function profileBlock() {
    return state.profile?.blockMinutes || 45;
  }

  function profileBreak() {
    return state.profile?.breakMinutes || 10;
  }

  function dayWindow(_dayIndex) {
    const p = state.profile;
    if (!p) return null;
    if (p.homeworkBeginMin != null && p.homeworkFinishMin != null) {
      if (p.homeworkFinishMin <= p.homeworkBeginMin) return null;
      return { startMin: p.homeworkBeginMin, endMin: p.homeworkFinishMin };
    }
    const d = p.availability?.[_dayIndex];
    if (!d || d.off) return null;
    return { startMin: d.startMin, endMin: d.endMin };
  }

  function commitmentsForDay(dayIndex) {
    const blocks = state.profile?.commitmentBlocks || [];
    return blocks.filter((c) => c.day === dayIndex);
  }

  function freeIntervalsForDate(dateObj) {
    const day = dateObj.getDay();
    const win = dayWindow(day);
    if (!win) return [];
    let intervals = [{ start: win.startMin, end: win.endMin }];
    const commits = commitmentsForDay(day).sort((a, b) => a.startMin - b.startMin);
    for (const c of commits) {
      const next = [];
      for (const iv of intervals) {
        if (c.endMin <= iv.start || c.startMin >= iv.end) {
          next.push(iv);
          continue;
        }
        if (c.startMin > iv.start) {
          next.push({ start: iv.start, end: Math.min(c.startMin, iv.end) });
        }
        if (c.endMin < iv.end) {
          next.push({ start: Math.max(c.endMin, iv.start), end: iv.end });
        }
      }
      intervals = next.filter((iv) => iv.end - iv.start >= 15);
    }
    return intervals;
  }

  function addMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `message ${role}`;
    bubble.textContent = text;
    els.messages.appendChild(bubble);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseCommitmentLine(text) {
    if (!text || /^(none|no|n\/a|nothing)$/i.test(text.trim())) return [];
    const items = [];
    const parts = text.split(/,|;|\band\b/i);
    for (const part of parts) {
      const days = [];
      const lower = part.toLowerCase();
      for (const [name, idx] of Object.entries(DAY_ALIASES)) {
        if (name.length < 3) continue;
        if (new RegExp(`\\b${name}\\b`).test(lower)) days.push(idx);
      }
      const times = [...lower.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/g)];
      let startMin = null;
      let endMin = null;
      if (times.length >= 2) {
        startMin = parseTimeToMin(times[0][0]);
        endMin = parseTimeToMin(times[1][0]);
      } else {
        const range = lower.match(
          /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
        );
        if (range) {
          startMin = parseTimeToMin(range[1]);
          endMin = parseTimeToMin(range[2]);
        }
      }
      const label =
        part
          .replace(
            /\b(mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\b/gi,
            ""
          )
          .replace(/\d{1,2}(?::\d{2})?\s*(am|pm)?/gi, "")
          .replace(/[-–]/g, " ")
          .replace(/\s+/g, " ")
          .trim() || "Commitment";
      if (days.length && startMin != null && endMin != null && endMin > startMin) {
        for (const day of [...new Set(days)]) {
          items.push({ day, startMin, endMin, label });
        }
      }
    }
    return items;
  }

  function showSetup(editing = false) {
    els.setupScreen.hidden = false;
    els.appShell.hidden = true;
    els.setupError.hidden = true;
    els.classRows.innerHTML = "";
    const defaults = defaultSemesterBounds();
    if (editing && state.profile) {
      document.getElementById("setup-name").value = state.profile.name || "";
      document.getElementById("setup-school-end").value = minToTimeInput(
        state.profile.schoolEndMin
      );
      document.getElementById("setup-hw-begin").value = minToTimeInput(
        state.profile.homeworkBeginMin
      );
      document.getElementById("setup-hw-finish").value = minToTimeInput(
        state.profile.homeworkFinishMin
      );
      document.getElementById("setup-commitments").value =
        state.profile.commitmentsNote || "";
      document.getElementById("setup-semester-start").value =
        state.profile.semesterStart || defaults.start;
      document.getElementById("setup-semester-end").value =
        state.profile.semesterEnd || defaults.end;
      const sorted = [...(state.profile.classes || [])].sort(
        (a, b) => (a.period || 0) - (b.period || 0)
      );
      sorted.forEach((c) => addClassRow(c.period, c.name, c.teacher || "", c.id));
    } else {
      document.getElementById("setup-name").value = "";
      document.getElementById("setup-semester-start").value = defaults.start;
      document.getElementById("setup-semester-end").value = defaults.end;
    }
    syncAddClassButton();
  }

  function showApp() {
    els.setupScreen.hidden = true;
    els.appShell.hidden = false;
  }

  function addClassRow(period = "", name = "", teacher = "", classId = "") {
    const row = document.createElement("div");
    row.className = "class-row";
    const nextPeriod =
      period || els.classRows.querySelectorAll(".class-row").length + 1;
    row.dataset.classId = classId || "";
    row.innerHTML = `
      <label class="field">
        <span>Period</span>
        <input class="class-period" type="number" min="1" max="20" required value="${escapeHtml(String(nextPeriod))}" placeholder="1" />
      </label>
      <label class="field">
        <span>Class name</span>
        <input class="class-name" type="text" required placeholder="e.g. Biology" value="${escapeHtml(name)}" />
      </label>
      <label class="field">
        <span>Teacher (optional)</span>
        <input class="class-teacher" type="text" placeholder="Optional" value="${escapeHtml(teacher)}" />
      </label>
      <button type="button" class="btn-remove-class">Remove</button>
    `;
    row.querySelector(".btn-remove-class").addEventListener("click", () => {
      row.remove();
      syncAddClassButton();
    });
    els.classRows.appendChild(row);
    syncAddClassButton();
  }

  function syncAddClassButton() {
    if (!els.addClassBtn) return;
    const count = els.classRows.querySelectorAll(".class-row").length;
    els.addClassBtn.textContent = count === 0 ? "Add a class" : "Add another class";
  }

  function collectSetupProfile() {
    const name = document.getElementById("setup-name").value.trim();
    const schoolEndMin = timeInputToMin(document.getElementById("setup-school-end").value);
    const homeworkBeginMin = timeInputToMin(document.getElementById("setup-hw-begin").value);
    const homeworkFinishMin = timeInputToMin(document.getElementById("setup-hw-finish").value);
    const commitmentsNote = document.getElementById("setup-commitments").value.trim();

    const classes = [];
    for (const row of els.classRows.querySelectorAll(".class-row")) {
      const className = row.querySelector(".class-name").value.trim();
      const period = Number(row.querySelector(".class-period").value);
      const teacher = row.querySelector(".class-teacher").value.trim();
      if (!className) continue;
      classes.push({
        id: row.dataset.classId || uid("c"),
        name: className,
        period: Number.isFinite(period) ? period : classes.length + 1,
        teacher,
        aliases: classAliases(className),
      });
    }
    classes.sort((a, b) => a.period - b.period);

    if (!name) return { error: "Please enter your first name." };
    if (!classes.length) return { error: "Add at least one class." };
    if (schoolEndMin == null || homeworkBeginMin == null || homeworkFinishMin == null) {
      return { error: "Please fill in your school and homework times." };
    }
    if (homeworkBeginMin < schoolEndMin) {
      return { error: "Homework begin time should be at or after you get home." };
    }
    if (homeworkFinishMin <= homeworkBeginMin) {
      return { error: "Finish time needs to be after homework can begin." };
    }

    const semesterStart = document.getElementById("setup-semester-start")?.value || "";
    const semesterEnd = document.getElementById("setup-semester-end")?.value || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(semesterStart) || !/^\d{4}-\d{2}-\d{2}$/.test(semesterEnd)) {
      return { error: "Please set your semester start and end dates." };
    }
    if (semesterEnd < semesterStart) {
      return { error: "Semester end needs to be on or after the start date." };
    }

    return {
      profile: {
        name: name.charAt(0).toUpperCase() + name.slice(1),
        classes,
        schoolEndMin,
        homeworkBeginMin,
        homeworkFinishMin,
        commitmentsNote,
        commitmentBlocks: parseCommitmentLine(commitmentsNote),
        semesterStart,
        semesterEnd,
        blockMinutes: state.profile?.blockMinutes || 45,
        breakMinutes: state.profile?.breakMinutes || 10,
      },
    };
  }

  function openHomeworkModal() {
    if (!state.profile) return;
    els.hwError.hidden = true;
    els.hwForm.reset();
    const select = document.getElementById("hw-class");
    if (select) {
      select.innerHTML = "";
      const sorted = [...state.profile.classes].sort(
        (a, b) => (a.period || 0) - (b.period || 0)
      );
      for (const cls of sorted) {
        const opt = document.createElement("option");
        opt.value = cls.id;
        opt.textContent = `P${cls.period} — ${cls.name}`;
        select.appendChild(opt);
      }
    }
    const dueInput = document.getElementById("hw-due");
    if (dueInput) {
      dueInput.min = isoDate(startOfToday());
      // Require an intentional choice — do not prefill tomorrow.
      dueInput.value = "";
    }
    els.hwModal.hidden = false;
    document.getElementById("hw-title")?.focus();
  }

  function closeHomeworkModal() {
    els.hwModal.hidden = true;
  }

  function addHomeworkFromForm() {
    const classId = document.getElementById("hw-class")?.value;
    const title = document.getElementById("hw-title")?.value.trim();
    const dueDate = document.getElementById("hw-due")?.value;
    const dueTimeRaw = document.getElementById("hw-due-time")?.value;
    const minutes = Number(document.getElementById("hw-minutes")?.value);
    const difficulty = document.getElementById("hw-difficulty")?.value || "medium";
    const notes = document.getElementById("hw-notes")?.value.trim() || "";

    if (!classId) return "Pick a class.";
    if (!title) return "Enter an assignment title.";
    if (!dueDate) return "Pick a due date.";
    if (!Number.isFinite(minutes) || minutes < 5) {
      return "Enter estimated minutes (at least 5).";
    }

    const dueTimeMin = dueTimeRaw ? timeInputToMin(dueTimeRaw) : null;
    const roundedMinutes = Math.max(5, Math.min(600, roundUp(minutes, 5)));

    const assignment = {
      id: uid(),
      classId,
      title,
      assignedDate: isoDate(startOfToday()),
      dueDate,
      dueTimeMin,
      minutes: roundedMinutes,
      remainingMinutes: roundedMinutes,
      difficulty: DIFFICULTY[difficulty] ? difficulty : "medium",
      notes,
      done: false,
      progressDate: isoDate(startOfToday()),
      completedTodayMinutes: 0,
    };

    state.assignments.push(assignment);
    save();
    const result = buildPlan();
    renderPlan();
    closeHomeworkModal();

    const cls = classById(assignment.classId);
    const dueLabel =
      formatDue(assignment.dueDate) +
      (assignment.dueTimeMin != null ? ` by ${formatClock(assignment.dueTimeMin)}` : "");
    const msg = `Added “${assignment.title}” for Period ${cls?.period} — ${cls?.name}. Due ${dueLabel} · ~${roundedMinutes} min.\n\n${formatPlanText(result)}`;
    addMessage("bot", msg);
    return null;
  }

  function todayBudgetMinutes(assignment) {
    ensureProgressDay(assignment);
    const remaining = remainingOf(assignment);
    if (remaining <= 0) return 0;
    const dueIn = daysUntilDue(assignment.dueDate);
    // Far-future work stays in Later — not on Today's actionable list.
    if (dueIn > 4) return 0;
    const already = assignment.completedTodayMinutes || 0;
    const block = profileBlock();
    let target;
    if (dueIn <= 1) target = remaining;
    else {
      target = Math.ceil(remaining / dueIn);
      if (target < Math.min(30, block) && remaining >= 30) {
        target = Math.min(block, Math.max(30, target));
      }
      if (target > Math.max(block, 60)) target = Math.max(block, 60);
    }
    return Math.max(0, Math.min(remaining, target) - already);
  }

  function splitIntoBlocks(totalMins) {
    const pref = profileBlock();
    const maxB = Math.min(60, Math.max(pref, 45));
    const minB = Math.min(30, pref);
    if (totalMins <= 0) return [];
    if (totalMins <= maxB) return [totalMins];
    const chunks = [];
    let left = totalMins;
    while (left > 0) {
      if (left <= maxB) {
        chunks.push(left);
        break;
      }
      let size = Math.min(maxB, pref);
      if (left - size < minB && left - size > 0) {
        size = Math.floor(left / 2);
      }
      chunks.push(size);
      left -= size;
    }
    return chunks;
  }

  function weekdayLabel(iso) {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function urgencyScore(a) {
    const days = daysUntilDue(a.dueDate);
    const load = DIFFICULTY[a.difficulty]?.load || 2;
    return days * 100 - load * 10 - Math.min(remainingOf(a), 120) * 0.05;
  }

  function sortForScheduling(list) {
    return [...list].sort((a, b) => urgencyScore(a) - urgencyScore(b));
  }

  function buildUpcoming(open, todayScheduledMinsById) {
    const upcoming = [];
    for (const assignment of sortForScheduling(open)) {
      const dueIn = daysUntilDue(assignment.dueDate);
      let left =
        remainingOf(assignment) - (todayScheduledMinsById.get(assignment.id) || 0);
      if (left <= 0 || dueIn <= 1) continue;
      for (let dayOffset = 1; dayOffset <= dueIn && left > 0; dayOffset++) {
        const dateObj = addDays(startOfToday(), dayOffset);
        const intervals = freeIntervalsForDate(dateObj);
        if (!intervals.length) continue;
        const daysLeft = dueIn - dayOffset + 1;
        let portion = Math.ceil(left / daysLeft);
        const pref = profileBlock();
        if (portion < 30 && left >= 30) portion = Math.min(pref, 30);
        if (portion > 60) portion = Math.min(pref, 60);
        portion = Math.min(left, portion);
        const iso = isoDate(dateObj);
        let day = upcoming.find((d) => d.iso === iso);
        if (!day) {
          day = { iso, label: weekdayLabel(iso), items: [] };
          upcoming.push(day);
        }
        day.items.push({
          assignmentId: assignment.id,
          title: assignment.title,
          className: classById(assignment.classId)?.name || "Class",
          minutes: portion,
          difficulty: assignment.difficulty,
        });
        left -= portion;
      }
    }
    upcoming.sort((a, b) => (a.iso < b.iso ? -1 : 1));
    return upcoming;
  }

  function buildPlan(fromMin = null) {
    const open = openAssignments();
    if (!state.profile) {
      state.plan = [];
      state.upcoming = [];
      return { plan: [], upcoming: [], warnings: [], overload: false };
    }

    const today = startOfToday();
    const intervals = freeIntervalsForDate(today).map((iv) => ({ ...iv }));
    if (fromMin != null) {
      for (const iv of intervals) {
        if (iv.end > fromMin) iv.start = Math.max(iv.start, fromMin);
      }
    } else {
      const now = nowMinutes();
      for (const iv of intervals) {
        if (iv.end > now) iv.start = Math.max(iv.start, roundUp(now));
      }
    }
    const usable = intervals.filter((iv) => iv.end - iv.start >= 20);
    const totalFree = usable.reduce((s, iv) => s + (iv.end - iv.start), 0);
    const maxFocusToday = Math.floor(totalFree * MAX_FOCUS_FRACTION);

    const plan = [];
    const todayScheduledMinsById = new Map();
    let focusScheduled = 0;
    const warnings = [];

    const candidates = sortForScheduling(open);
    const workQueue = [];
    let demandedToday = 0;
    for (const assignment of candidates) {
      const budget = todayBudgetMinutes(assignment);
      if (budget <= 0) continue;
      demandedToday += budget;
      const load = DIFFICULTY[assignment.difficulty]?.load || 2;
      const dueIn = daysUntilDue(assignment.dueDate);
      for (const mins of splitIntoBlocks(budget)) {
        workQueue.push({ assignment, mins, load, dueIn });
      }
    }

    // Deadline urgency first, then harder work earlier within the same due band.
    workQueue.sort((a, b) => {
      if (a.dueIn !== b.dueIn) return a.dueIn - b.dueIn;
      if (b.load !== a.load) return b.load - a.load;
      return b.mins - a.mins;
    });
    // Pack overdue/due-today first so they reserve focus before farther work.
    const dueNowQueue = workQueue.filter((item) => item.dueIn <= 0);
    const fartherQueue = workQueue.filter((item) => item.dueIn > 0);

    const breakMins = profileBreak();
    let ivIndex = 0;
    let cursor = usable[0]?.start ?? 0;
    let lastWasWork = false;
    let packingStopped = false;

    function advanceTo(minNeeded) {
      while (ivIndex < usable.length) {
        const iv = usable[ivIndex];
        if (cursor < iv.start) cursor = iv.start;
        if (cursor + minNeeded <= iv.end) return true;
        ivIndex += 1;
        if (ivIndex < usable.length) {
          cursor = usable[ivIndex].start;
          lastWasWork = false;
        }
      }
      return false;
    }

    function scheduleWorkItem(item) {
      if (packingStopped) return;
      const { assignment, mins, load, dueIn } = item;
      if (focusScheduled + mins > maxFocusToday && dueIn > 0) return;
      if (load >= 3) {
        const windowStart = usable[0]?.start ?? 0;
        const windowEnd = usable[usable.length - 1]?.end ?? 0;
        const mid = windowStart + (windowEnd - windowStart) * 0.55;
        if (cursor > mid && dueIn > 1) return;
      }

      const need = lastWasWork ? mins + breakMins : mins;
      if (!advanceTo(need)) {
        packingStopped = true;
        return;
      }

      if (lastWasWork) {
        plan.push({
          id: uid("p"),
          type: "break",
          label: "Break",
          start: cursor,
          end: cursor + breakMins,
        });
        cursor += breakMins;
      }

      if (!advanceTo(mins)) {
        packingStopped = true;
        return;
      }

      plan.push({
        id: uid("p"),
        type: "work",
        assignmentId: assignment.id,
        label: classById(assignment.classId)?.name || "Work",
        detail: assignment.title,
        start: cursor,
        end: cursor + mins,
        minutes: mins,
        difficulty: assignment.difficulty,
      });
      cursor += mins;
      focusScheduled += mins;
      todayScheduledMinsById.set(
        assignment.id,
        (todayScheduledMinsById.get(assignment.id) || 0) + mins
      );
      lastWasWork = true;
    }

    for (const item of dueNowQueue) scheduleWorkItem(item);
    for (const item of fartherQueue) scheduleWorkItem(item);

    const upcoming = buildUpcoming(open, todayScheduledMinsById);
    let overload = false;
    // Full same-day / overdue workload (every difficulty) vs realistic focus time.
    const sameDay = open.filter((a) => daysUntilDue(a.dueDate) <= 0);
    const sameDayNeed = sameDay.reduce((sum, a) => sum + remainingOf(a), 0);
    if (usable.length && sameDayNeed > maxFocusToday + 20) {
      overload = true;
      warnings.push(
        `Due/overdue today totals ~${sameDayNeed} min across all classes (including easier work), but realistic focus time is about ${maxFocusToday} min — roughly ${sameDayNeed - maxFocusToday} min will not fit.`
      );
    }
    for (const a of sameDay) {
      const need = remainingOf(a);
      const got = todayScheduledMinsById.get(a.id) || 0;
      if (got < need) {
        overload = true;
        warnings.push(
          `“${a.title}” still needs ~${need - got} min today and isn’t fully on your plan.`
        );
      }
    }
    const leftoverAfterSameDay = Math.max(0, maxFocusToday - sameDayNeed);
    const tomorrow = open.filter((a) => daysUntilDue(a.dueDate) === 1);
    const tomorrowNeed = tomorrow.reduce((sum, a) => sum + remainingOf(a), 0);
    if (usable.length && tomorrowNeed > leftoverAfterSameDay + 20) {
      overload = true;
      warnings.push(
        `Work due tomorrow still needs ~${tomorrowNeed} min, but after today’s due work only about ${leftoverAfterSameDay} min of focus is left.`
      );
    }
    for (const a of tomorrow) {
      const need = remainingOf(a);
      const got = todayScheduledMinsById.get(a.id) || 0;
      if (got < need && sameDayNeed + need > maxFocusToday + 20) {
        overload = true;
        warnings.push(
          `“${a.title}” still needs ~${need - got} min before ${formatDue(a.dueDate)}, and it may not fit with everything due today.`
        );
      }
    }
    // Near-term multi-day slices can also exceed focus after same-day/tomorrow demand.
    if (
      usable.length &&
      demandedToday > maxFocusToday + 20 &&
      !warnings.some((w) => w.includes("realistic focus time"))
    ) {
      overload = true;
      warnings.push(
        `Today’s planned slices total ~${demandedToday} min; realistic focus time is about ${maxFocusToday} min.`
      );
    }

    state.plan = plan;
    state.upcoming = upcoming;
    return {
      plan,
      upcoming,
      warnings,
      overload,
      unscheduled: open.filter(
        (a) =>
          !(todayScheduledMinsById.get(a.id) > 0) &&
          !upcoming.some((d) => d.items.some((i) => i.assignmentId === a.id))
      ),
    };
  }

  function formatPlanText(result = null) {
    const built =
      result || {
        plan: state.plan,
        upcoming: state.upcoming || [],
        warnings: [],
        overload: false,
      };
    const name = state.profile?.name || "there";
    const hasWork = built.plan.some((b) => b.type === "work");

    if (!hasWork) {
      if (!openAssignments().length) {
        return `Nothing on the board yet, ${name}. When you get an assignment, tap Add Homework.`;
      }
      if (built.upcoming?.length) {
        const lines = [
          "Nothing heavy on today’s plan — you’ve got time before the deadlines.",
          "",
          "Coming up:",
        ];
        for (const day of built.upcoming) {
          for (const item of day.items) {
            lines.push(
              `• ${day.label}: ${item.className} — ${item.title} (${item.minutes} min)`
            );
          }
        }
        return lines.join("\n");
      }
      return "I couldn’t fit work into today’s available window. If something’s due soon, tell me and we’ll make a tight priority call — I won’t pretend it all fits.";
    }

    const lines = ["Today’s Plan:"];
    for (const block of built.plan) {
      const range = formatTimeRange(block.start, block.end);
      if (block.type === "break") lines.push(`${range} break`);
      else {
        const bit = block.detail ? ` — ${block.detail}` : "";
        lines.push(`${range} ${block.label}${bit}`);
      }
    }

    if (built.upcoming?.length) {
      lines.push("");
      lines.push("Later this week:");
      for (const day of built.upcoming) {
        for (const item of day.items) {
          lines.push(
            `• ${day.label}: ${item.className} — ${item.title} (${item.minutes} min)`
          );
        }
      }
    }

    if (built.warnings?.length) {
      lines.push("");
      lines.push(built.overload ? "Heads-up — this may not all fit:" : "Note:");
      for (const w of built.warnings) lines.push(`• ${w}`);
    }

    const next = built.plan.find((b) => b.type === "work");
    if (next) {
      lines.push("");
      lines.push(
        `Start with ${next.label} at ${formatClock(next.start).replace(":00", "")}.`
      );
    }
    return lines.join("\n");
  }

  function currentWorkBlock() {
    const t = nowMinutes();
    return (
      state.plan.find(
        (b) =>
          b.type === "work" &&
          t >= b.start &&
          t < b.end &&
          !state.assignments.find((a) => a.id === b.assignmentId)?.done
      ) ||
      state.plan.find(
        (b) =>
          b.type === "work" &&
          !state.assignments.find((a) => a.id === b.assignmentId)?.done
      ) ||
      null
    );
  }

  function completeSession(id, minutes, { fromChat, block } = {}) {
    const a = state.assignments.find((x) => x.id === id);
    if (!a || a.done) return null;

    ensureProgressDay(a);
    const before = remainingOf(a);
    const chunk = Math.min(before, Math.max(0, minutes || before));
    if (chunk <= 0) return a;
    a.remainingMinutes = Math.max(0, before - chunk);
    a.completedTodayMinutes = (a.completedTodayMinutes || 0) + chunk;

    let finished = false;
    if (a.remainingMinutes <= 0) {
      a.done = true;
      a.remainingMinutes = 0;
      finished = true;
    }

    pruneCompletedSessions();
    state.completedSessions.push({
      id: uid("s"),
      assignmentId: id,
      label: block?.label || classById(a.classId)?.name || "Work",
      detail: block?.detail || a.title,
      minutes: chunk,
      date: isoDate(startOfToday()),
    });

    save();
    const result = buildPlan(nowMinutes());
    renderPlan();

    if (!fromChat) {
      let reply = finished
        ? `Solid — “${a.title}” is finished.${finishLineNote(a.classId)}`
        : `Nice — that’s today’s chunk of “${a.title}.” ${a.remainingMinutes} min left before it’s due.`;
      reply += `\n\n${formatPlanText(result)}`;
      addMessage("bot", reply);
    }
    return a;
  }

  function undoSession(id, minutes, sessionId = null) {
    const a = state.assignments.find((x) => x.id === id);
    if (!a) return;
    ensureProgressDay(a);
    const chunk = Math.max(0, minutes || 0);
    if (a.done) {
      a.done = false;
      a.remainingMinutes = chunk;
      a.completedTodayMinutes = Math.max(0, (a.completedTodayMinutes || 0) - chunk);
    } else {
      a.remainingMinutes = Math.min(a.minutes, remainingOf(a) + chunk);
      a.completedTodayMinutes = Math.max(0, (a.completedTodayMinutes || 0) - chunk);
    }
    pruneCompletedSessions();
    if (sessionId) {
      state.completedSessions = state.completedSessions.filter((s) => s.id !== sessionId);
    } else {
      // Remove the most recent matching session for this assignment/chunk.
      for (let i = state.completedSessions.length - 1; i >= 0; i -= 1) {
        const s = state.completedSessions[i];
        if (s.assignmentId === id && s.minutes === chunk) {
          state.completedSessions.splice(i, 1);
          break;
        }
      }
    }
    save();
    rebuildAndRender();
  }

  function assignmentComplete(a) {
    return Boolean(a?.done);
  }

  function semesterBounds() {
    const defaults = defaultSemesterBounds();
    const start = state.profile?.semesterStart || defaults.start;
    const end = state.profile?.semesterEnd || defaults.end;
    return { start, end };
  }

  function daysBetweenIso(a, b) {
    const ms = Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`);
    return Math.round(ms / 86400000);
  }

  function assignmentInSemester(a) {
    if (!a) return false;
    const { start, end } = semesterBounds();
    const due = a.dueDate || "";
    const assigned = a.assignedDate || due;
    const inDue = due >= start && due <= end;
    const inAssigned = assigned >= start && assigned <= end;
    return inDue || inAssigned;
  }

  function classCompletion(classId) {
    const items = state.assignments.filter(
      (a) => a.classId === classId && assignmentInSemester(a)
    );
    const total = items.length;
    const done = items.filter(assignmentComplete).length;
    const doneMins = items
      .filter(assignmentComplete)
      .reduce((sum, a) => sum + (Number(a.minutes) || 0), 0);
    const knownMins = items.reduce((sum, a) => sum + (Number(a.minutes) || 0), 0);

    const { start, end } = semesterBounds();
    const todayIso = isoDate(startOfToday());
    const semesterDays = Math.max(1, daysBetweenIso(start, end) + 1);
    const elapsedRaw = daysBetweenIso(start, todayIso) + 1;
    const daysElapsed = Math.max(1, Math.min(semesterDays, elapsedRaw));
    // Pace uses at least a week so day-1 completions do not imply a tiny semester total.
    const paceDays = Math.max(daysElapsed, 7);
    const projectedTotal =
      knownMins > 0 ? (knownMins / paceDays) * semesterDays : 0;
    const effectiveTotal = Math.max(knownMins, projectedTotal, doneMins);
    const pct =
      effectiveTotal <= 0
        ? 0
        : Math.min(100, Math.round((doneMins / effectiveTotal) * 100));

    return { total, done, pct, doneMins, knownMins, effectiveTotal };
  }

  function finishLineNote(classId) {
    const { total, pct } = classCompletion(classId);
    if (!(total > 0 && pct >= 100)) return "";
    const cls = classById(classId);
    return `\n\nFinish Line Reached for ${cls?.name || "this class"}.`;
  }

  function renderProgress() {
    if (!els.classProgress) return;
    els.classProgress.innerHTML = "";
    const classes = state.profile?.classes || [];
    if (!classes.length) {
      els.classProgress.innerHTML =
        `<div class="class-bar"><p class="class-bar-note muted" style="margin:0">Add classes in setup to track the finish line.</p></div>`;
      return;
    }

    const sorted = [...classes].sort((a, b) => (a.period || 0) - (b.period || 0));
    for (const cls of sorted) {
      const { total, pct } = classCompletion(cls.id);
      const finish = total > 0 && pct >= 100;
      const row = document.createElement("div");
      row.className = `class-bar${finish ? " finish-line" : ""}`;
      const label =
        total === 0
          ? "No assignments yet"
          : "Semester progress";
      row.innerHTML = `
        <div class="progress-meta">
          <span class="class-bar-name">P${cls.period} · ${escapeHtml(cls.name)}</span>
          <span class="class-bar-pct">${pct}%</span>
        </div>
        <div
          class="progress-track"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="${pct}"
          aria-label="${escapeHtml(cls.name)} semester finish line ${pct} percent"
        >
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        ${
          finish
            ? `<p class="class-bar-note">Finish Line Reached</p>`
            : `<p class="class-bar-note muted">${label}</p>`
        }
      `;
      els.classProgress.appendChild(row);
    }
  }

  function renderPlan() {
    els.planList.innerHTML = "";
    const doneSessions = completedSessionsToday();
    const hasPlan = state.plan.length > 0 || doneSessions.length > 0;
    els.emptyPlan.classList.toggle("hidden", hasPlan);

    for (const session of doneSessions) {
      const li = document.createElement("li");
      li.className = "plan-item plan-work done";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = true;
      check.setAttribute(
        "aria-label",
        `Undo session for ${session.label} ${session.detail || ""}`
      );
      check.addEventListener("change", () => {
        if (!check.checked) {
          undoSession(session.assignmentId, session.minutes, session.id);
        }
      });
      const body = document.createElement("div");
      body.className = "plan-body";
      body.innerHTML = `
        <span class="plan-time">${session.minutes} min · done</span>
        <span class="plan-label">${escapeHtml(session.label)}</span>
        <span class="plan-detail">${escapeHtml(session.detail || "")}</span>
      `;
      li.append(check, body);
      els.planList.appendChild(li);
    }

    for (const block of state.plan) {
      const li = document.createElement("li");
      li.className = `plan-item plan-${block.type}`;

      if (block.type === "break") {
        li.innerHTML = `<span class="plan-time">${formatTimeRange(block.start, block.end)}</span><span class="plan-label">Break</span>`;
        els.planList.appendChild(li);
        continue;
      }

      const assignment = state.assignments.find((a) => a.id === block.assignmentId);
      const fullyDone = Boolean(assignment?.done);
      if (fullyDone) li.classList.add("done");
      const current =
        !fullyDone && nowMinutes() >= block.start && nowMinutes() < block.end;
      if (current) li.classList.add("current");

      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = false;
      check.setAttribute(
        "aria-label",
        `Mark ${block.label} ${block.detail || ""} session complete`
      );
      check.addEventListener("change", () => {
        if (check.checked) {
          completeSession(block.assignmentId, block.minutes, {
            fromChat: false,
            block,
          });
        }
      });

      const body = document.createElement("div");
      body.className = "plan-body";
      body.innerHTML = `
        <span class="plan-time">${formatTimeRange(block.start, block.end)}</span>
        <span class="plan-label">${escapeHtml(block.label)}</span>
        <span class="plan-detail">${escapeHtml(block.detail || "")}</span>
      `;

      li.append(check, body);
      els.planList.appendChild(li);
    }

    const upcoming = state.upcoming || [];
    els.backlog.hidden = upcoming.length === 0;
    els.backlogList.innerHTML = "";
    for (const day of upcoming) {
      for (const item of day.items) {
        const li = document.createElement("li");
        li.textContent = `${day.label}: ${item.className} — ${item.title} (${item.minutes} min)`;
        els.backlogList.appendChild(li);
      }
    }
    renderProgress();
  }

  function rebuildAndRender() {
    if (state.profile) buildPlan();
    else {
      state.plan = [];
      state.upcoming = [];
    }
    renderPlan();
  }

  function stopForToday() {
    const workBlocks = state.plan.filter((b) => b.type === "work");
    if (!workBlocks.length) {
      return "Nothing left scheduled for today anyway — you’re clear.";
    }
    for (const block of workBlocks) {
      const a = state.assignments.find((x) => x.id === block.assignmentId);
      if (!a || a.done) continue;
      ensureProgressDay(a);
      a.completedTodayMinutes = (a.completedTodayMinutes || 0) + block.minutes;
    }
    save();
    const result = buildPlan();
    renderPlan();
    return `Got it — I cleared the rest of today’s plan. Those assignments will show up on upcoming days.\n\n${formatPlanText(result)}`;
  }

  function tryCompleteFromChat(text) {
    if (!/\b(done|finished|complete|completed|checked off)\b/.test(text.toLowerCase())) {
      return null;
    }
    let block = currentWorkBlock();
    let assignment = block
      ? state.assignments.find((a) => a.id === block.assignmentId)
      : null;
    const cls = findClassInText(text);
    if (cls) {
      assignment = openAssignments().find((a) => a.classId === cls.id) || assignment;
      block =
        state.plan.find((b) => b.type === "work" && b.assignmentId === assignment?.id) ||
        block;
    }
    if (!assignment) return "I don’t see an open task to complete.";

    const mins = block?.minutes || todayBudgetMinutes(assignment) || remainingOf(assignment);
    completeSession(assignment.id, mins, { fromChat: true });
    return assignment.done
      ? `Got it — “${assignment.title}” is finished.${finishLineNote(assignment.classId)}\n\n${formatPlanText()}`
      : `Session noted for “${assignment.title}.” ${assignment.remainingMinutes} min left.\n\n${formatPlanText()}`;
  }

  function replyTo(text) {
    if (!state.profile) {
      return "Please finish the setup form first — then we can plan.";
    }

    const lower = text.toLowerCase().trim();
    const name = state.profile.name;

    if (/^(hi|hello|hey)\b/.test(lower)) {
      return `Hey ${name}. Tap Add Homework to enter assignments — or ask what’s next.`;
    }

    if (/\b(what can you do)\b/.test(lower) || lower === "help") {
      return [
        "I help you schedule homework around your real day.",
        "You can ask:",
        "• What’s on today’s plan?",
        "• What should I do next?",
        "• I only have 30 minutes.",
        "• I’m behind.",
        "• Can I move this until tomorrow?",
        "• Can I stop for today?",
        "• How close am I to the finish line?",
        "• Add homework",
      ].join("\n");
    }

    if (/\b(settings|my schedule|my classes|edit schedule)\b/.test(lower)) {
      const classes = [...state.profile.classes]
        .sort((a, b) => a.period - b.period)
        .map((c) => `Period ${c.period} — ${c.name}`)
        .join("\n");
      const win = dayWindow(new Date().getDay());
      return [
        `Name: ${name}`,
        classes,
        win
          ? `Homework window: ${formatClock(win.startMin)}–${formatClock(win.endMin)}`
          : "No homework window set.",
        state.profile.commitmentsNote
          ? `Commitments: ${state.profile.commitmentsNote}`
          : "No regular commitments listed.",
        "",
        "Tap Edit schedule to change this.",
      ].join("\n");
    }

    if (/\b(plan|today'?s plan|schedule)\b/.test(lower)) {
      const result = buildPlan();
      renderPlan();
      return formatPlanText(result);
    }

    if (/\b(what('?s| is) next|what should i (do|work on)|what now)\b/.test(lower)) {
      rebuildAndRender();
      const block = currentWorkBlock();
      if (!block) return formatPlanText();
      return `Right now: ${formatTimeRange(block.start, block.end)} — ${block.label}${block.detail ? ` (${block.detail})` : ""}.`;
    }

    if (/\bonly have\s+(\d+)\s*min/.test(lower) || /\b(\d+)\s*minutes?\s+only\b/.test(lower)) {
      const m = lower.match(/(\d+)\s*min/);
      const mins = m ? Number(m[1]) : 30;
      const open = openAssignments().sort((a, b) => urgencyScore(a) - urgencyScore(b));
      if (!open.length) return "Nothing on your list — add homework when you’re ready.";
      const pick =
        open.find((a) => remainingOf(a) <= mins + 10) ||
        open.find((a) => (DIFFICULTY[a.difficulty]?.load || 2) <= 2) ||
        open[0];
      return `With about ${mins} minutes, I’d do a focused slice of “${pick.title}” (${classById(pick.classId)?.name}). Start now and stop cleanly when time’s up — don’t try to finish the whole thing unless it’s tiny.`;
    }

    if (/\b(i'?m behind|behind schedule|too much|overwhelmed)\b/.test(lower)) {
      const result = buildPlan();
      renderPlan();
      const urgent = openAssignments()
        .filter((a) => daysUntilDue(a.dueDate) <= 1)
        .sort((a, b) => urgencyScore(a) - urgencyScore(b));
      if (!urgent.length) {
        return `You’re not in emergency mode. Stick to today’s plan and protect your finish time.\n\n${formatPlanText(result)}`;
      }
      return [
        "Alright — when you’re behind, we narrow the field.",
        "Prioritize only what’s due today or tomorrow:",
        ...urgent.map(
          (a) =>
            `• ${a.title} (${classById(a.classId)?.name}) — due ${formatDue(a.dueDate)}, ~${remainingOf(a)} min left`
        ),
        "",
        formatPlanText(result),
      ].join("\n");
    }

    if (/\b(finished early|i finished early|done early|finished ahead)\b/.test(lower)) {
      const block = currentWorkBlock() || state.plan.find((b) => b.type === "work");
      if (!block) return "Nothing on the plan right now — enjoy the extra time.";
      const a = state.assignments.find((x) => x.id === block.assignmentId);
      if (!a) return "I don’t see an open task to mark done.";
      completeSession(a.id, block.minutes, { fromChat: true });
      const finished = a.done;
      return finished
        ? `Nice — marked that block done.${finishLineNote(a.classId)}\n\n${formatPlanText()}`
        : `Nice — marked that block done. ${a.remainingMinutes} min left on “${a.title}.”\n\n${formatPlanText()}`;
    }

    if (/\b(can i stop for today|stop for today|done for today|call it for today)\b/.test(lower)) {
      return stopForToday();
    }

    if (/\b(move|push|delay|tomorrow|reschedule)\b/.test(lower)) {
      const block = currentWorkBlock() || state.plan.find((b) => b.type === "work");
      const a = block
        ? state.assignments.find((x) => x.id === block.assignmentId)
        : openAssignments()[0];
      if (!a) return "Nothing to move — your list is clear.";
      const dueIn = daysUntilDue(a.dueDate);
      if (dueIn <= 0) {
        return `“${a.title}” is due today — I wouldn’t push it. Let’s keep it on today’s plan.`;
      }
      ensureProgressDay(a);
      const remaining = remainingOf(a);
      const skip = Math.max(
        profileBlock(),
        dueIn <= 1 ? remaining : Math.ceil(remaining / Math.max(dueIn, 1))
      );
      a.completedTodayMinutes = Math.max(a.completedTodayMinutes || 0, skip);
      save();
      const result = buildPlan();
      renderPlan();
      return `Okay — I won’t schedule more of “${a.title}” today. It’ll show up in the coming days before ${formatDue(a.dueDate)}.\n\n${formatPlanText(result)}`;
    }

    if (/\b(points|progress|finish line|how close|completion)\b/.test(lower)) {
      const classes = state.profile?.classes || [];
      if (!classes.length) {
        return "Add your classes in setup first — then each one gets a semester finish-line bar.";
      }
      const { start, end } = semesterBounds();
      const lines = classes
        .slice()
        .sort((a, b) => (a.period || 0) - (b.period || 0))
        .map((cls) => {
          const { total, pct } = classCompletion(cls.id);
          if (!total) return `• P${cls.period} ${cls.name}: no assignments yet (0%)`;
          if (pct >= 100) {
            return `• P${cls.period} ${cls.name}: ${pct}% — Finish Line Reached`;
          }
          return `• P${cls.period} ${cls.name}: ${pct}% semester progress`;
        });
      return [
        `Here’s your Finish Line Friend semester progress (${start} → ${end}):`,
        ...lines,
      ].join("\n");
    }

    if (/\b(add homework|new assignment|enter homework)\b/.test(lower)) {
      openHomeworkModal();
      return "Opening Add Homework — fill in the details and I’ll build your plan.";
    }

    const completed = tryCompleteFromChat(text);
    if (completed) return completed;

    if (openAssignments().length) {
      return "Ask “what’s next?”, “I’m behind”, or tap Add Homework for a new assignment.";
    }

    return "Tap Add Homework to enter an assignment — I’ll schedule it around your day.";
  }

  function handleUserMessage(text) {
    const cleaned = text.trim();
    if (!cleaned) return;
    addMessage("user", cleaned);
    const reply = replyTo(cleaned);
    if (reply) window.setTimeout(() => addMessage("bot", reply), 180);
  }

  function greet() {
    if (!state.profile) {
      showSetup(false);
      renderProgress();
      return;
    }
    showApp();
    rebuildAndRender();
    const name = state.profile.name;
    if (openAssignments().length && state.plan.some((b) => b.type === "work")) {
      addMessage(
        "bot",
        `Hey ${name}. Here’s where things stand.\n\n${formatPlanText()}`
      );
    } else {
      addMessage(
        "bot",
        `Hey ${name}. When you get homework, tap Add Homework — I’ll fit it around your schedule and keep adjusting your plan.`
      );
    }
  }

  function ensureMusicGraph() {
    if (focusMusic.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = focusMusic.volume * 0.22;
    master.connect(ctx.destination);

    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 420;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.35;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);

    const padGain = ctx.createGain();
    padGain.gain.value = 0.08;
    padGain.connect(master);
    const freqs = [174.61, 220.0, 261.63];
    const oscs = freqs.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 1 ? "triangle" : "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.45;
      o.connect(g);
      g.connect(padGain);
      return o;
    });

    focusMusic.ctx = ctx;
    focusMusic.nodes = { master, noise, oscs, noiseGain, padGain };
  }

  function setMusicVolume(v) {
    focusMusic.volume = v;
    if (focusMusic.nodes?.master) {
      focusMusic.nodes.master.gain.value = v * 0.22;
    }
  }

  async function toggleFocusMusic() {
    if (focusMusic.playing) {
      stopFocusMusic();
      return;
    }
    ensureMusicGraph();
    if (!focusMusic.ctx) {
      addMessage("bot", "Focus Music isn’t available in this browser.");
      return;
    }
    if (focusMusic.ctx.state === "suspended") await focusMusic.ctx.resume();
    const { noise, oscs } = focusMusic.nodes;
    try {
      noise.start();
    } catch {
      /* already started */
    }
    oscs.forEach((o) => {
      try {
        o.start();
      } catch {
        /* already started */
      }
    });
    focusMusic.playing = true;
    if (els.musicToggle) {
      els.musicToggle.textContent = "Pause";
      els.musicToggle.setAttribute("aria-pressed", "true");
    }
    if (els.musicVolume) els.musicVolume.disabled = false;
  }

  function stopFocusMusic() {
    if (focusMusic.ctx) {
      focusMusic.ctx.suspend();
    }
    focusMusic.playing = false;
    if (els.musicToggle) {
      els.musicToggle.textContent = "Play";
      els.musicToggle.setAttribute("aria-pressed", "false");
    }
  }

  els.addClassBtn?.addEventListener("click", () => addClassRow());
  els.setupForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const result = collectSetupProfile();
    if (result.error) {
      els.setupError.hidden = false;
      els.setupError.textContent = result.error;
      return;
    }
    state.profile = result.profile;
    save();
    showApp();
    rebuildAndRender();
    els.messages.innerHTML = "";
    addMessage(
      "bot",
      `You’re set, ${state.profile.name}. Your classes and homework window are saved.\n\nTap Add Homework to enter assignments — I’ll build today’s plan around your schedule. Ask “what’s next?” anytime.`
    );
    els.input?.focus();
  });

  els.addHomeworkBtn?.addEventListener("click", () => openHomeworkModal());
  els.editSetupBtn?.addEventListener("click", () => showSetup(true));

  els.hwForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = addHomeworkFromForm();
    if (err) {
      els.hwError.hidden = false;
      els.hwError.textContent = err;
    }
  });

  els.hwModal?.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => closeHomeworkModal());
  });

  els.form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = els.input.value;
    els.input.value = "";
    handleUserMessage(value);
  });

  els.musicToggle?.addEventListener("click", () => {
    toggleFocusMusic();
  });
  els.musicVolume?.addEventListener("input", () => {
    setMusicVolume(Number(els.musicVolume.value));
  });

  load();
  greet();
  if (state.profile) els.input?.focus();
})();
