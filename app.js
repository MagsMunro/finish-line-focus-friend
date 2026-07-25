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

  const WORK_TYPES = [
    "reading",
    "writing",
    "studying",
    "problem-set",
    "project",
    "practice",
    "other",
  ];

  const state = {
    profile: null,
    assignments: [],
    plan: [],
    upcoming: [],
    checkpoint: null,
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
    readingFields: document.getElementById("reading-fields"),
    messages: document.getElementById("messages"),
    form: document.getElementById("chat-form"),
    input: document.getElementById("chat-input"),
    fileInput: document.getElementById("file-input"),
    planList: document.getElementById("plan-list"),
    emptyPlan: document.getElementById("empty-plan"),
    readingStatus: document.getElementById("reading-status"),
    readingStatusList: document.getElementById("reading-status-list"),
    checkpointPanel: document.getElementById("checkpoint-panel"),
    cpTitle: document.getElementById("cp-title"),
    cpMeta: document.getElementById("cp-meta"),
    cpBadges: document.getElementById("cp-badges"),
    cpProgress: document.getElementById("cp-progress"),
    cpBody: document.getElementById("cp-body"),
    cpActions: document.getElementById("cp-actions"),
    cpClose: document.getElementById("cp-close"),
    musicToggle: document.getElementById("music-toggle"),
    musicVolume: document.getElementById("music-volume"),
    backlog: document.getElementById("backlog"),
    backlogList: document.getElementById("backlog-list"),
    classProgress: document.getElementById("class-progress"),
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
    } catch {
      /* ignore */
    }
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

    return {
      name: p.name || "Student",
      classes,
      schoolEndMin,
      homeworkBeginMin,
      homeworkFinishMin,
      commitmentsNote,
      commitmentBlocks,
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
      ...a,
      title: String(a.title || "Assignment").replace(/\s+/g, " ").trim(),
      minutes,
      remainingMinutes: Math.max(0, Math.min(minutes, remaining)),
      difficulty: DIFFICULTY[a.difficulty] ? a.difficulty : "medium",
      workType: WORK_TYPES.includes(a.workType) ? a.workType : "other",
      dueDate: a.dueDate || isoDate(addDays(startOfToday(), 2)),
      assignedDate: a.assignedDate || a.dueDate || isoDate(startOfToday()),
      dueTimeMin: Number.isFinite(a.dueTimeMin) ? a.dueTimeMin : null,
      notes: a.notes || "",
      bookName: a.bookName || "",
      chaptersOrPages: a.chaptersOrPages || "",
      done: Boolean(a.done),
      progressDate: a.progressDate === today ? today : today,
      completedTodayMinutes:
        a.progressDate === today && Number.isFinite(a.completedTodayMinutes)
          ? Math.max(0, a.completedTodayMinutes)
          : 0,
      readingText: typeof a.readingText === "string" ? a.readingText : null,
      checkpoints: Array.isArray(a.checkpoints)
        ? a.checkpoints.map(normalizeCheckpoint)
        : [],
    };
  }

  function normalizeCheckpoint(cp) {
    let comprehension = cp.comprehension;
    if (!comprehension) {
      if (cp.status === "done" || cp.status === "passed") comprehension = "passed";
      else if (cp.status === "review") comprehension = "review";
      else comprehension = "pending";
    }
    return {
      id: cp.id || uid("cp"),
      label: cp.label || "Reading check",
      readingComplete: Boolean(cp.readingComplete || cp.status === "done"),
      comprehension,
      needsText: cp.needsText !== false,
    };
  }

  function checkpointPassed(cp) {
    return cp.comprehension === "passed";
  }

  function comprehensionLabel(cp) {
    if (cp.comprehension === "passed") return "Passed";
    if (cp.comprehension === "review") return "Needs a bit more";
    return "Pending";
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
    if (!ap && h <= 12 && h < 7) h += 12; // bare "3" → 3pm for homework context
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

    for (const [name, i] of Object.entries(DAY_ALIASES)) {
      if (name.length < 3) continue;
      if (new RegExp(`\\b(?:next\\s+)?${name}\\b`).test(lower)) {
        const current = today.getDay();
        let delta = (i - current + 7) % 7;
        if (delta === 0 || /\bnext\s+/.test(lower)) {
          if (delta === 0) delta = 7;
          else if (/\bnext\s+/.test(lower) && delta < 7) {
            /* keep next occurrence; if already next week name with next, add 7 if same week intended */
          }
        }
        if (delta === 0) delta = 7;
        return isoDate(addDays(today, delta));
      }
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

  function parseMinutes(text) {
    const lower = text.toLowerCase();
    const hours = lower.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/);
    const mins = lower.match(/\b(\d+)\s*(?:minutes?|mins?|m)\b/);
    if (hours && mins) {
      return Math.round(Number(hours[1]) * 60 + Number(mins[1]));
    }
    if (hours) return Math.round(Number(hours[1]) * 60);
    if (mins) return Number(mins[1]);
    const pages = lower.match(/\b(\d+)\s*pages?\b/);
    if (pages) return Math.max(20, Number(pages[1]) * 3);
    const chapters = lower.match(/\bchapters?\s+(\d+)\s*[-–to]+\s*(\d+)\b/) ||
      lower.match(/\b(\d+)\s*chapters?\b/);
    if (chapters) {
      if (chapters[2]) {
        return Math.max(30, (Number(chapters[2]) - Number(chapters[1]) + 1) * 25);
      }
      return Math.max(30, Number(chapters[1]) * 25);
    }
    const bare = lower.match(/^(\d+)$/);
    if (bare) {
      const n = Number(bare[1]);
      return n <= 8 ? n * 60 : n;
    }
    return null;
  }

  function parseDifficulty(text) {
    const lower = text.toLowerCase();
    if (/\b(easy|light|low|chill|simple)\b/.test(lower)) return "easy";
    if (/\b(hard|tough|heavy|difficult|intense)\b/.test(lower)) return "hard";
    if (/\b(medium|moderate|mid|normal|okay|ok|average)\b/.test(lower)) return "medium";
    return null;
  }

  function parseWorkType(text) {
    const lower = text.toLowerCase();
    if (/\b(read|reading|chapter|chapters|textbook|novel|pages?)\b/.test(lower)) {
      return "reading";
    }
    if (/\b(essay|write|writing|paper|draft|paragraph)\b/.test(lower)) return "writing";
    if (/\b(study|studying|review|flashcards?|quiz prep)\b/.test(lower)) return "studying";
    if (/\b(problem\s*set|worksheet|problems?|homework set|math)\b/.test(lower)) {
      return "problem-set";
    }
    if (/\b(project|presentation|lab report)\b/.test(lower)) return "project";
    if (/\b(practice|rehearse|drill|exercises?)\b/.test(lower)) return "practice";
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

  /** Free intervals today after subtracting commitments. */
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

  // ——— Setup & homework forms ———

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
      let label = part
        .replace(/\b(mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\b/gi, "")
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
      const sorted = [...(state.profile.classes || [])].sort(
        (a, b) => (a.period || 0) - (b.period || 0)
      );
      if (!sorted.length) addClassRow(1, "", "", "");
      else sorted.forEach((c) => addClassRow(c.period, c.name, c.teacher || "", c.id));
    } else {
      document.getElementById("setup-name").value = "";
      addClassRow(1, "", "", "");
    }
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
    const removeBtn = row.querySelector(".btn-remove-class");
    removeBtn.addEventListener("click", () => {
      if (els.classRows.querySelectorAll(".class-row").length <= 1) return;
      row.remove();
      syncRemoveButtons();
    });
    els.classRows.appendChild(row);
    syncRemoveButtons();
  }

  function syncRemoveButtons() {
    const rows = els.classRows.querySelectorAll(".class-row");
    rows.forEach((row) => {
      const btn = row.querySelector(".btn-remove-class");
      if (btn) btn.disabled = rows.length <= 1;
    });
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

    return {
      profile: {
        name: name.charAt(0).toUpperCase() + name.slice(1),
        classes,
        schoolEndMin,
        homeworkBeginMin,
        homeworkFinishMin,
        commitmentsNote,
        commitmentBlocks: parseCommitmentLine(commitmentsNote),
        blockMinutes: state.profile?.blockMinutes || 45,
        breakMinutes: state.profile?.breakMinutes || 10,
      },
    };
  }

  function extractChapterRange(text) {
    const m = String(text || "").match(/chapters?\s+(\d+)\s*[-–to]+\s*(\d+)/i);
    if (m) return { from: Number(m[1]), to: Number(m[2]) };
    const single = String(text || "").match(/chapter\s+(\d+)/i);
    if (single) return { from: Number(single[1]), to: Number(single[1]) };
    const pages = String(text || "").match(/pp?\.?\s*(\d+)\s*[-–to]+\s*(\d+)/i);
    if (pages) return { from: Number(pages[1]), to: Number(pages[2]), pages: true };
    return null;
  }

  function buildReadingCheckpoints(title, minutes, chaptersOrPages = "") {
    const range = extractChapterRange(chaptersOrPages) || extractChapterRange(title);
    const checkpoints = [];
    const base = () => ({
      readingComplete: false,
      comprehension: "pending",
      needsText: true,
    });
    if (range && range.to >= range.from && !range.pages) {
      for (let ch = range.from; ch <= range.to; ch++) {
        checkpoints.push({
          id: uid("cp"),
          label: `Chapter ${ch}`,
          ...base(),
        });
      }
    } else if (range?.pages) {
      const span = range.to - range.from + 1;
      const parts = Math.max(1, Math.ceil(span / 25));
      for (let i = 0; i < parts; i++) {
        checkpoints.push({
          id: uid("cp"),
          label: parts === 1 ? "Reading section" : `Pages part ${i + 1}`,
          ...base(),
        });
      }
    } else {
      const sessions = Math.max(1, Math.ceil(minutes / Math.max(profileBlock(), 30)));
      for (let i = 0; i < sessions; i++) {
        checkpoints.push({
          id: uid("cp"),
          label: sessions === 1 ? "Reading section" : `Reading part ${i + 1}`,
          ...base(),
        });
      }
    }
    return checkpoints;
  }

  function populateClassDropdown() {
    const select = document.getElementById("hw-class");
    if (!select || !state.profile) return;
    const classes = [...state.profile.classes].sort((a, b) => a.period - b.period);
    select.innerHTML = classes
      .map(
        (c) =>
          `<option value="${escapeHtml(c.id)}">Period ${c.period} — ${escapeHtml(c.name)}</option>`
      )
      .join("");
  }

  function openHomeworkModal() {
    if (!state.profile) return;
    populateClassDropdown();
    els.hwError.hidden = true;
    els.hwForm.reset();
    document.getElementById("hw-assigned").value = isoDate(startOfToday());
    document.getElementById("hw-due").value = isoDate(addDays(startOfToday(), 2));
    document.getElementById("hw-minutes").value = "45";
    document.getElementById("hw-difficulty").value = "medium";
    document.getElementById("hw-type").value = "reading";
    toggleReadingFields();
    els.hwModal.hidden = false;
    document.getElementById("hw-title").focus();
  }

  function closeHomeworkModal() {
    els.hwModal.hidden = true;
  }

  function toggleReadingFields() {
    const isReading = document.getElementById("hw-type").value === "reading";
    els.readingFields.hidden = !isReading;
    const book = document.getElementById("hw-book");
    const chapters = document.getElementById("hw-chapters");
    if (book) book.required = isReading;
    if (chapters) chapters.required = isReading;
  }

  function addHomeworkFromForm() {
    const classId = document.getElementById("hw-class").value;
    const title = document.getElementById("hw-title").value.trim();
    const assignedDate = document.getElementById("hw-assigned").value;
    const dueDate = document.getElementById("hw-due").value;
    const dueTimeRaw = document.getElementById("hw-due-time").value;
    const workType = document.getElementById("hw-type").value;
    const minutes = Number(document.getElementById("hw-minutes").value);
    const difficulty = document.getElementById("hw-difficulty").value;
    const notes = document.getElementById("hw-notes").value.trim();
    const bookName = document.getElementById("hw-book").value.trim();
    const chaptersOrPages = document.getElementById("hw-chapters").value.trim();
    const readingText = document.getElementById("hw-reading-text").value.trim();

    if (!classId || !title) return "Class and assignment name are required.";
    if (!assignedDate || !dueDate) return "Please set assigned and due dates.";
    if (!Number.isFinite(minutes) || minutes < 5) return "Estimated time should be at least 5 minutes.";
    if (dueDate < assignedDate) return "Due date can’t be before the assigned date.";
    if (workType === "reading") {
      if (!bookName) return "For reading, please enter the book or text title.";
      if (!chaptersOrPages) {
        return "For reading, please enter the chapter(s) or pages.";
      }
    }

    const displayTitle =
      workType === "reading"
        ? `${bookName}: ${chaptersOrPages}`
        : title;

    const assignment = {
      id: uid(),
      classId,
      title: displayTitle,
      assignedDate,
      dueDate,
      dueTimeMin: timeInputToMin(dueTimeRaw),
      minutes,
      remainingMinutes: minutes,
      difficulty,
      workType,
      notes,
      bookName,
      chaptersOrPages,
      done: false,
      progressDate: isoDate(startOfToday()),
      completedTodayMinutes: 0,
      readingText: readingText.length >= 40 ? readingText : null,
      checkpoints:
        workType === "reading"
          ? buildReadingCheckpoints(displayTitle, minutes, chaptersOrPages)
          : [],
    };

    if (assignment.workType === "reading" && assignment.readingText) {
      for (const cp of assignment.checkpoints) cp.needsText = false;
    }

    state.assignments.push(assignment);
    save();
    const result = buildPlan();
    renderPlan();
    closeHomeworkModal();

    const cls = classById(classId);
    const dueLabel =
      formatDue(dueDate) +
      (assignment.dueTimeMin != null ? ` by ${formatClock(assignment.dueTimeMin)}` : "");
    let msg = `Added “${assignment.title}” for Period ${cls?.period} — ${cls?.name}. Due ${dueLabel}.\n\n${formatPlanText(result)}`;
    if (assignment.workType === "reading") {
      msg += `\n\nAfter you finish each reading session, a Quick Check will open (3 short questions). Understanding — not just finishing the pages — is what marks it complete.`;
      if (!assignment.readingText) {
        msg += " You’ll be asked to paste the section you read before the questions (I won’t invent the book).";
      }
    }
    addMessage("bot", msg);
    return null;
  }

  // ——— Planning ———

  function todayBudgetMinutes(assignment) {
    ensureProgressDay(assignment);
    const remaining = remainingOf(assignment);
    if (remaining <= 0) return 0;
    const dueIn = daysUntilDue(assignment.dueDate);
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
      if (dueIn > 4 && remaining <= 30 && already === 0) return 0;
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
    let warnings = [];

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

    workQueue.sort((a, b) => {
      if (b.load !== a.load) return b.load - a.load;
      if (a.dueIn !== b.dueIn) return a.dueIn - b.dueIn;
      return b.mins - a.mins;
    });

    const breakMins = profileBreak();
    let ivIndex = 0;
    let cursor = usable[0]?.start ?? 0;
    let lastWasWork = false;

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

    for (const item of workQueue) {
      const { assignment, mins, load, dueIn } = item;
      if (focusScheduled + mins > maxFocusToday && dueIn > 0) continue;
      if (load >= 3) {
        // Prefer earlier half of available window
        const windowStart = usable[0]?.start ?? 0;
        const windowEnd = usable[usable.length - 1]?.end ?? 0;
        const mid = windowStart + (windowEnd - windowStart) * 0.55;
        if (cursor > mid && dueIn > 1) continue;
      }

      const need = lastWasWork ? mins + breakMins : mins;
      if (!advanceTo(need)) break;

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

      if (!advanceTo(mins)) break;

      const nextCp = (assignment.checkpoints || []).find((c) => !checkpointPassed(c));
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
        workType: assignment.workType,
        checkpointId: assignment.workType === "reading" ? nextCp?.id || null : null,
      });
      cursor += mins;
      focusScheduled += mins;
      todayScheduledMinsById.set(
        assignment.id,
        (todayScheduledMinsById.get(assignment.id) || 0) + mins
      );
      lastWasWork = true;
    }

    const upcoming = buildUpcoming(open, todayScheduledMinsById);
    let overload = false;
    for (const a of open) {
      const dueIn = daysUntilDue(a.dueDate);
      if (dueIn > 1) continue;
      const need = remainingOf(a);
      const got = todayScheduledMinsById.get(a.id) || 0;
      if (got < need) {
        overload = true;
        warnings.push(
          `“${a.title}” still needs ~${need - got} min before ${formatDue(a.dueDate)}, and it may not fit your available time.`
        );
      }
    }
    if (demandedToday > maxFocusToday + 20 && usable.length) {
      warnings.push(
        `Today’s realistic focus time is about ${maxFocusToday} min; there’s more on your plate than that. We’ll prioritize what’s due soonest.`
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
        return `Nothing on the board yet, ${name}. When you get an assignment, tell me about it.`;
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
        const cp =
          block.checkpointId && block.workType === "reading" ? " · Quick Check after" : "";
        lines.push(`${range} ${block.label}${bit}${cp}`);
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

  // ——— Quick Check (from student-provided text only) ———

  function sentencesFrom(text) {
    return text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.split(/\s+/).length >= 6 && s.length < 280);
  }

  function significantWords(s) {
    const stop = new Set(
      "the a an and or but in on at to for of as is was were be been being with that this these those it its from by into about over after before between out up down than then so if when what who whom which how why not no yes do does did can could would should will just also very more most other into".split(
        " "
      )
    );
    return s
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w));
  }

  function makeQuestionsFromText(passage, count = 3) {
    const target = Math.min(3, Math.max(2, count));
    const sentences = sentencesFrom(passage);
    if (sentences.length < 2) return null;
    const questions = [];
    const used = new Set();

    // Cloze from content-heavy sentences
    for (const s of sentences) {
      if (questions.length >= target) break;
      const words = s.split(/\s+/);
      const candidates = words
        .map((w, i) => ({ w, i }))
        .filter(({ w }) => /^[A-Z]/.test(w) || w.length > 6);
      if (!candidates.length) continue;
      const pick = candidates[Math.floor(candidates.length / 2)];
      const answer = pick.w.replace(/[^\w']/g, "");
      if (used.has(answer.toLowerCase()) || answer.length < 3) continue;
      used.add(answer.toLowerCase());
      const blanked = words.map((w, i) => (i === pick.i ? "______" : w)).join(" ");
      questions.push({
        prompt: `From the passage you pasted, fill in the blank:\n“${blanked}”`,
        expect: answer,
        expectWords: significantWords(answer),
        source: s,
        kind: "cloze",
      });
    }

    // “What does this sentence say?” paraphrase check
    for (const s of sentences) {
      if (questions.length >= target) break;
      if (used.has(s.slice(0, 40))) continue;
      used.add(s.slice(0, 40));
      questions.push({
        prompt: `In your own words, what is this part of the reading saying?\n“${s}”`,
        expect: s,
        expectWords: significantWords(s),
        source: s,
        kind: "paraphrase",
      });
    }

    if (questions.length < 2) return null;
    return questions.slice(0, target);
  }

  function scoreAnswer(answer, question) {
    const aw = significantWords(answer);
    if (!aw.length) return 0;
    const ew = question.expectWords?.length
      ? question.expectWords
      : significantWords(question.expect);
    if (!ew.length) return 0;
    let hits = 0;
    for (const w of ew) {
      if (aw.some((a) => a === w || a.includes(w) || w.includes(a))) hits += 1;
    }
    const recall = hits / ew.length;
    const precision = hits / aw.length;
    if (question.kind === "cloze") {
      const norm = answer.toLowerCase().replace(/[^a-z0-9']/g, "");
      const exp = question.expect.toLowerCase().replace(/[^a-z0-9']/g, "");
      if (norm === exp || norm.includes(exp) || exp.includes(norm)) return 1;
      return recall >= 0.5 ? 0.7 : 0;
    }
    return recall * 0.7 + precision * 0.3;
  }

  function simplerFollowUp(question) {
    const words = significantWords(question.source || question.expect || "");
    const hint = words.slice(0, 3).join(", ");
    return {
      prompt: hint
        ? `No pressure — looking just at this line from your reading:\n“${question.source}”\n\nWhat is it mainly about? (a few words are enough${hint ? ` — think along the lines of: ${hint}` : ""})`
        : `Looking at this line from your reading:\n“${question.source}”\n\nIn plain words, what’s happening or what’s the main point?`,
      expect: question.expect,
      expectWords: question.expectWords,
      source: question.source,
      kind: "paraphrase",
    };
  }

  function beginCheckpoint(assignment, checkpoint) {
    checkpoint.comprehension =
      checkpoint.comprehension === "review" ? "review" : "pending";
    state.checkpoint = {
      assignmentId: assignment.id,
      checkpointId: checkpoint.id,
      phase: assignment.readingText ? "ask" : "need_text",
      questions: [],
      index: 0,
      scores: [],
    };

    const bookBit = [assignment.bookName, assignment.chaptersOrPages]
      .filter(Boolean)
      .join(" · ");

    if (!assignment.readingText) {
      state.checkpoint.phase = "need_text";
      renderCheckpointPanel();
      return [
        `Quick Check: ${checkpoint.label}${bookBit ? ` (${bookBit})` : ""}.`,
        "",
        "You finished the reading session — nice. Before this block counts as complete, a short Quick Check.",
        "Paste the section you just read (or upload .txt). I only ask about that text — I don’t invent the book.",
      ].join("\n");
    }

    const qs = makeQuestionsFromText(assignment.readingText, 3);
    if (!qs || qs.length < 2) {
      state.checkpoint.phase = "need_text";
      renderCheckpointPanel();
      return "I need a bit more of the passage (a few full sentences) before we can do a fair Quick Check.";
    }
    // Always aim for 3 basic questions
    state.checkpoint.questions = qs.slice(0, 3);
    while (
      state.checkpoint.questions.length < 3 &&
      qs[state.checkpoint.questions.length]
    ) {
      state.checkpoint.questions.push(qs[state.checkpoint.questions.length]);
    }
    state.checkpoint.phase = "ask";
    renderCheckpointPanel();
    return [
      `Quick Check started for ${checkpoint.label}.`,
      bookBit ? `Reading: ${bookBit}` : "",
      "Three short questions — this is a check for understanding, not a test.",
      `Question 1 of ${state.checkpoint.questions.length} is in the Quick Check panel.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  function renderCheckpointPanel() {
    const cpState = state.checkpoint;
    if (!cpState || !els.checkpointPanel) return;
    const assignment = state.assignments.find((a) => a.id === cpState.assignmentId);
    const checkpoint = assignment?.checkpoints?.find((c) => c.id === cpState.checkpointId);
    if (!assignment || !checkpoint) {
      els.checkpointPanel.hidden = true;
      return;
    }

    els.checkpointPanel.hidden = false;
    const bookBit = [assignment.bookName, assignment.chaptersOrPages]
      .filter(Boolean)
      .join(" · ");
    els.cpTitle.textContent = `Quick Check · ${checkpoint.label}`;
    els.cpMeta.textContent = `${bookBit || assignment.title} · ${classById(assignment.classId)?.name || ""}`;
    els.cpBadges.innerHTML = `
      <span class="status-badge ${checkpoint.readingComplete ? "ok" : "pending"}">Reading: ${checkpoint.readingComplete ? "complete" : "not done"}</span>
      <span class="status-badge ${
        checkpoint.comprehension === "passed"
          ? "ok"
          : checkpoint.comprehension === "review"
            ? "warn"
            : "pending"
      }">Quick Check: ${comprehensionLabel(checkpoint)}</span>
    `;

    els.cpActions.innerHTML = "";
    els.cpBody.innerHTML = "";

    if (cpState.phase === "need_text") {
      els.cpProgress.textContent = "Paste what you just read to begin";
      els.cpBody.innerHTML = `
        <p>This isn’t a quiz from memory of the whole book — only from the section you paste.</p>
        <textarea id="cp-answer" placeholder="Paste reading passage here…"></textarea>
      `;
      const submit = document.createElement("button");
      submit.type = "button";
      submit.className = "btn-primary";
      submit.textContent = "Start Quick Check";
      submit.addEventListener("click", () => {
        const val = document.getElementById("cp-answer")?.value || "";
        const reply = handleCheckpoint(val);
        if (reply) addMessage("bot", reply);
      });
      els.cpActions.appendChild(submit);
      return;
    }

    if (cpState.phase === "ask" || cpState.phase === "retry") {
      const q = cpState.questions[cpState.index];
      const total = cpState.questions.length;
      els.cpProgress.textContent =
        cpState.phase === "retry"
          ? "One simpler follow-up"
          : `Question ${cpState.index + 1} of ${total}`;
      els.cpBody.innerHTML = `
        <p>${escapeHtml(q.prompt)}</p>
        <textarea id="cp-answer" placeholder="A short answer is fine…"></textarea>
      `;
      const submit = document.createElement("button");
      submit.type = "button";
      submit.className = "btn-primary";
      submit.textContent = "Submit";
      submit.addEventListener("click", () => {
        const val = document.getElementById("cp-answer")?.value || "";
        const reply = handleCheckpoint(val);
        if (reply) addMessage("bot", reply);
      });
      els.cpActions.appendChild(submit);
      return;
    }

    if (cpState.phase === "done") {
      els.cpProgress.textContent =
        checkpoint.comprehension === "passed" ? "Quick Check passed" : "Quick Check paused";
      els.cpBody.innerHTML = `<p>${escapeHtml(cpState.summary || "Quick Check finished.")}</p>`;
      const close = document.createElement("button");
      close.type = "button";
      close.className = "btn-primary";
      close.textContent = "Back to plan";
      close.addEventListener("click", () => closeCheckpointPanel());
      els.cpActions.appendChild(close);
    }
  }

  function closeCheckpointPanel() {
    if (els.checkpointPanel) els.checkpointPanel.hidden = true;
    if (state.checkpoint?.phase === "done") state.checkpoint = null;
    renderPlan();
  }

  function handleCheckpoint(text) {
    const cpState = state.checkpoint;
    if (!cpState) {
      return "No Quick Check is open. Mark a reading session done in Today’s Plan first.";
    }
    const assignment = state.assignments.find((a) => a.id === cpState.assignmentId);
    const checkpoint = assignment?.checkpoints?.find((c) => c.id === cpState.checkpointId);
    if (!assignment || !checkpoint) {
      state.checkpoint = null;
      closeCheckpointPanel();
      return "That Quick Check got lost — open it again from Today’s Plan.";
    }

    if (/^(cancel|skip|later|close)$/i.test(text.trim())) {
      closeCheckpointPanel();
      state.checkpoint = null;
      return "Quick Check paused. It stays Pending until you finish it — no penalty.";
    }

    if (cpState.phase === "need_text") {
      if (text.trim().length < 80) {
        renderCheckpointPanel();
        return "Paste a longer stretch (at least a short paragraph) so the Quick Check stays fair.";
      }
      assignment.readingText =
        (assignment.readingText ? assignment.readingText + "\n\n" : "") + text.trim();
      save();
      const qs = makeQuestionsFromText(assignment.readingText, 3);
      if (!qs || qs.length < 2) {
        renderCheckpointPanel();
        return "Thanks — could you paste a bit more? A few complete sentences help.";
      }
      cpState.questions = qs.slice(0, 3);
      cpState.phase = "ask";
      cpState.index = 0;
      cpState.scores = [];
      renderCheckpointPanel();
      return `Got the passage. Quick Check — 3 short questions. Question 1 of ${cpState.questions.length}.`;
    }

    if (cpState.phase === "ask" || cpState.phase === "retry") {
      const q = cpState.questions[cpState.index];
      const score = scoreAnswer(text, q);
      const passMark = cpState.phase === "retry" ? 0.35 : 0.45;

      if (score >= passMark) {
        cpState.scores.push(Math.max(score, 0.5));
        cpState.index += 1;
        cpState.phase = "ask";
        if (cpState.index >= cpState.questions.length) {
          return finishCheckpoint(assignment, checkpoint, true);
        }
        renderCheckpointPanel();
        return `That tracks with the reading. Question ${cpState.index + 1} of ${cpState.questions.length}.`;
      }

      // Soft support path — never just "wrong"
      if (cpState.phase === "ask") {
        cpState.phase = "retry";
        checkpoint.comprehension = "review";
        save();
        const follow = simplerFollowUp(q);
        cpState.questions[cpState.index] = follow;
        renderCheckpointPanel();
        els.cpBody.innerHTML = `
          <p>Something about this part seems unclear — that’s normal. Here’s a simpler follow-up from your text:</p>
          <p>${escapeHtml(follow.prompt).replace(/\n/g, "<br>")}</p>
          <textarea id="cp-answer" placeholder="A few words are enough…"></textarea>
        `;
        const submit = document.createElement("button");
        submit.type = "button";
        submit.className = "btn-primary";
        submit.textContent = "Answer follow-up";
        submit.addEventListener("click", () => {
          const val = document.getElementById("cp-answer")?.value || "";
          const reply = handleCheckpoint(val);
          if (reply) addMessage("bot", reply);
        });
        els.cpActions.innerHTML = "";
        els.cpActions.appendChild(submit);
        return "Let’s slow down on that part — I pulled the idea from your text and asked a simpler follow-up in the Quick Check panel.";
      }

      // After softer follow-up still shaky: explain from source, credit partial, continue
      cpState.scores.push(score);
      cpState.index += 1;
      cpState.phase = "ask";
      const note = `Here’s what that part of your reading is saying, in short: “${q.source}”`;
      if (cpState.index >= cpState.questions.length) {
        const ok =
          cpState.scores.filter((s) => s >= 0.35).length >=
          Math.ceil(cpState.questions.length / 2);
        return `${note}\n\n${finishCheckpoint(assignment, checkpoint, ok)}`;
      }
      renderCheckpointPanel();
      return `${note}\n\nWe’ll keep going — Question ${cpState.index + 1} of ${cpState.questions.length}.`;
    }

    return "Use the Quick Check panel, or type your answer here.";
  }

  function finishCheckpoint(assignment, checkpoint, understood) {
    if (understood) {
      checkpoint.comprehension = "passed";
      checkpoint.readingComplete = true;
      ensureProgressDay(assignment);
      const chunk = Math.min(
        remainingOf(assignment),
        Math.max(
          20,
          Math.round(assignment.minutes / Math.max(1, assignment.checkpoints.length))
        )
      );
      assignment.remainingMinutes = Math.max(0, remainingOf(assignment) - chunk);
      assignment.completedTodayMinutes = (assignment.completedTodayMinutes || 0) + chunk;

      const allPassed = assignment.checkpoints.every(checkpointPassed);
      if (allPassed) {
        assignment.done = true;
        assignment.remainingMinutes = 0;
      }

      save();
      const result = buildPlan(nowMinutes());
      renderPlan();

      let reply = `Quick Check passed for “${checkpoint.label}.” Reading block complete.`;
      if (assignment.done) {
        reply += `\n\nAll set — “${assignment.title}” is complete with understanding.`;
        reply += finishLineNote(assignment.classId);
      } else {
        reply += " Other reading sections may still have their own Quick Check.";
      }
      reply += `\n\n${formatPlanText(result)}`;

      state.checkpoint.phase = "done";
      state.checkpoint.summary = reply;
      renderCheckpointPanel();
      return reply;
    }

    checkpoint.comprehension = "review";
    checkpoint.readingComplete = true;
    save();
    state.checkpoint.phase = "done";
    state.checkpoint.summary =
      `Quick Check for “${checkpoint.label}” still needs a bit more clarity — not a fail, just not done yet. ` +
      `When you’re ready, tap Quick Check again on Today’s Plan.`;
    renderCheckpointPanel();
    renderPlan();
    return state.checkpoint.summary;
  }

  function findPendingCheckpoint() {
    for (const a of openAssignments()) {
      if (a.workType !== "reading") continue;
      const cp = (a.checkpoints || []).find(
        (c) => c.readingComplete && !checkpointPassed(c)
      );
      if (cp) return { assignment: a, checkpoint: cp };
    }
    for (const a of openAssignments()) {
      if (a.workType !== "reading") continue;
      const cp = (a.checkpoints || []).find((c) => !checkpointPassed(c));
      if (cp) return { assignment: a, checkpoint: cp };
    }
    return null;
  }

  function nextReadingCheckpoint(assignment) {
    return (assignment.checkpoints || []).find((c) => !checkpointPassed(c)) || null;
  }

  // ——— Completion ———

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

  function completeSession(id, minutes, { fromChat, checkpointId }) {
    const a = state.assignments.find((x) => x.id === id);
    if (!a || a.done) return null;

    // Reading: mark session done, then auto-launch Quick Check — no full credit yet
    if (a.workType === "reading") {
      const cp =
        (checkpointId && a.checkpoints.find((c) => c.id === checkpointId)) ||
        nextReadingCheckpoint(a);
      if (!cp) {
        a.done = true;
        save();
        rebuildAndRender();
        return a;
      }
      cp.readingComplete = true;
      if (cp.comprehension !== "passed") {
        cp.comprehension = cp.comprehension === "review" ? "review" : "pending";
      }
      save();
      renderPlan();
      const msg = beginCheckpoint(a, cp);
      if (!fromChat) addMessage("bot", msg);
      return { redirected: true, message: msg, assignment: a };
    }

    ensureProgressDay(a);
    const before = remainingOf(a);
    const chunk = Math.min(before, Math.max(0, minutes || before));
    a.remainingMinutes = Math.max(0, before - chunk);
    a.completedTodayMinutes = (a.completedTodayMinutes || 0) + chunk;

    let finished = false;
    if (a.remainingMinutes <= 0) {
      a.done = true;
      a.remainingMinutes = 0;
      finished = true;
    }

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

  function undoSession(id, minutes) {
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
    save();
    rebuildAndRender();
  }

  // ——— Render ———

  function assignmentComplete(a) {
    if (!a) return false;
    if (a.workType === "reading") {
      const cps = a.checkpoints || [];
      if (!cps.length) return Boolean(a.done);
      // Reading alone is not enough — every Quick Check must pass
      return cps.every(checkpointPassed);
    }
    return Boolean(a.done);
  }

  function classCompletion(classId) {
    const items = state.assignments.filter((a) => a.classId === classId);
    const total = items.length;
    const done = items.filter(assignmentComplete).length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    return { total, done, pct };
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
      const { total, done, pct } = classCompletion(cls.id);
      const finish = total > 0 && pct >= 100;
      const row = document.createElement("div");
      row.className = `class-bar${finish ? " finish-line" : ""}`;
      const label =
        total === 0
          ? "No assignments yet"
          : `${done} / ${total} complete`;
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
          aria-label="${escapeHtml(cls.name)} completion ${pct} percent"
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
    const hasPlan = state.plan.length > 0;
    els.emptyPlan.classList.toggle("hidden", hasPlan);

    for (const block of state.plan) {
      const li = document.createElement("li");
      li.className = `plan-item plan-${block.type}`;

      if (block.type === "break") {
        li.innerHTML = `<span class="plan-time">${formatTimeRange(block.start, block.end)}</span><span class="plan-label">Break</span>`;
        els.planList.appendChild(li);
        continue;
      }

      const assignment = state.assignments.find((a) => a.id === block.assignmentId);
      const cp =
        block.workType === "reading" && block.checkpointId
          ? assignment?.checkpoints?.find((c) => c.id === block.checkpointId)
          : null;
      const readingDone = Boolean(cp?.readingComplete);
      const compPassed = cp ? checkpointPassed(cp) : false;
      const fullyDone = Boolean(assignment?.done) || compPassed;
      if (fullyDone) li.classList.add("done");
      const current =
        !fullyDone && nowMinutes() >= block.start && nowMinutes() < block.end;
      if (current) li.classList.add("current");

      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = block.workType === "reading" ? readingDone : fullyDone;
      check.setAttribute(
        "aria-label",
        block.workType === "reading"
          ? `Mark reading done for ${block.detail || block.label}`
          : `Mark ${block.label} ${block.detail || ""} complete`
      );
      check.addEventListener("change", () => {
        if (check.checked) {
          completeSession(block.assignmentId, block.minutes, {
            fromChat: false,
            checkpointId: block.checkpointId,
          });
        } else if (block.workType === "reading" && cp) {
          cp.readingComplete = false;
          if (cp.comprehension !== "passed") cp.comprehension = "pending";
          save();
          renderPlan();
        } else {
          undoSession(block.assignmentId, block.minutes);
        }
      });

      const body = document.createElement("div");
      body.className = "plan-body";
      let gateHtml = "";
      if (block.workType === "reading" && cp) {
        gateHtml = `
          <div class="status-badges">
            <span class="status-badge ${readingDone ? "ok" : "pending"}">Reading: ${readingDone ? "complete" : "not done"}</span>
            <span class="status-badge ${
              cp.comprehension === "passed"
                ? "ok"
                : cp.comprehension === "review"
                  ? "warn"
                  : "pending"
            }">Quick Check: ${comprehensionLabel(cp)}</span>
          </div>
          <p class="plan-gate">${escapeHtml(cp.label)} · Quick Check after reading</p>
        `;
      }
      body.innerHTML = `
        <span class="plan-time">${formatTimeRange(block.start, block.end)}</span>
        <span class="plan-label">${escapeHtml(block.label)}</span>
        <span class="plan-detail">${escapeHtml(block.detail || "")}</span>
        ${gateHtml}
      `;

      if (block.workType === "reading" && cp && readingDone && !compPassed) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-start-cp";
        btn.textContent =
          cp.comprehension === "review" ? "Continue Quick Check" : "Open Quick Check";
        btn.addEventListener("click", () => {
          const msg = beginCheckpoint(assignment, cp);
          addMessage("bot", msg);
        });
        body.appendChild(btn);
      }

      li.append(check, body);
      els.planList.appendChild(li);
    }

    renderReadingStatus();

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

  function renderReadingStatus() {
    if (!els.readingStatus || !els.readingStatusList) return;
    const readings = state.assignments.filter((a) => a.workType === "reading");
    els.readingStatus.hidden = readings.length === 0;
    els.readingStatusList.innerHTML = "";
    for (const a of readings) {
      const li = document.createElement("li");
      li.className = "reading-status-item";
      const cls = classById(a.classId);
      let gates = (a.checkpoints || [])
        .map((cp) => {
          return `<div class="cp-gate-row">
            <span>${escapeHtml(cp.label)} · Reading: ${cp.readingComplete ? "complete" : "not done"} · Quick Check: ${comprehensionLabel(cp)}</span>
            ${
              cp.readingComplete && !checkpointPassed(cp)
                ? `<button type="button" class="btn-start-cp" data-a="${a.id}" data-cp="${cp.id}">${
                    cp.comprehension === "review" ? "Continue Quick Check" : "Open Quick Check"
                  }</button>`
                : checkpointPassed(cp)
                  ? `<span class="status-badge ok">Passed</span>`
                  : ""
            }
          </div>`;
        })
        .join("");
      li.innerHTML = `
        <h4>${escapeHtml(a.title)}${a.done ? " · complete" : ""}</h4>
        <p class="rs-class">Period ${cls?.period ?? "?"} — ${escapeHtml(cls?.name || "")}</p>
        ${gates}
      `;
      li.querySelectorAll(".btn-start-cp").forEach((btn) => {
        btn.addEventListener("click", () => {
          const assignment = state.assignments.find((x) => x.id === btn.dataset.a);
          const cp = assignment?.checkpoints?.find((c) => c.id === btn.dataset.cp);
          if (!assignment || !cp) return;
          const msg = beginCheckpoint(assignment, cp);
          addMessage("bot", msg);
        });
      });
      els.readingStatusList.appendChild(li);
    }
  }

  function rebuildAndRender() {
    if (state.profile) buildPlan();
    else {
      state.plan = [];
      state.upcoming = [];
    }
    renderPlan();
  }

  // ——— Chat router ———

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

    if (assignment.workType === "reading") {
      const result = completeSession(assignment.id, block?.minutes, {
        fromChat: true,
        checkpointId: block?.checkpointId,
      });
      return (
        result?.message ||
        "Reading session done — finish the Quick Check before this counts as complete."
      );
    }

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

    if (state.checkpoint) {
      if (state.checkpoint.phase === "done") {
        state.checkpoint = null;
        if (els.checkpointPanel) els.checkpointPanel.hidden = true;
      } else {
        return handleCheckpoint(text);
      }
    }

    const lower = text.toLowerCase().trim();
    const name = state.profile.name;

    if (/^(hi|hello|hey)\b/.test(lower)) {
      return `Hey ${name}. Use Add Homework for new assignments, or ask me what to do next.`;
    }

    if (/\b(help|what can you do)\b/.test(lower)) {
      return [
        "Use Add Homework for new assignments (not chat).",
        "You can ask me things like:",
        "• What should I do next?",
        "• I only have 30 minutes.",
        "• I’m behind.",
        "• I don’t understand this.",
        "• Can I move this until tomorrow?",
        "• Today’s plan / Quick Check",
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

    if (
      /\b(what('?s| is) next|what should i (do|work on)|what now)\b/.test(lower)
    ) {
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

    if (/\b(don'?t understand|confused|i'?m stuck)\b/.test(lower)) {
      const found = findPendingCheckpoint();
      if (found) {
        return (
          "Let’s do a Quick Check on the reading — only from the text you share.\n\n" +
          beginCheckpoint(found.assignment, found.checkpoint)
        );
      }
      const block = currentWorkBlock();
      if (block) {
        return `Stuck on “${block.detail}”? Shrink it: spend 10 minutes on the smallest next step, write down exactly where it breaks, then ask a teacher/tutor with that note. If it’s reading, paste the section and say “quick check.”`;
      }
      return "Tell me which assignment is confusing, or paste the reading section and say “quick check.”";
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

    if (/\b(checkpoint|comprehension|quick check|quiz me|check understanding)\b/.test(lower)) {
      const found = findPendingCheckpoint();
      if (!found) {
        return "No open Quick Checks. Add a Reading assignment with Add Homework.";
      }
      return beginCheckpoint(found.assignment, found.checkpoint);
    }

    if (/\b(points|progress|finish line|how close|completion)\b/.test(lower)) {
      const classes = state.profile?.classes || [];
      if (!classes.length) return "Add your classes in setup first — then each one gets a finish-line bar.";
      const lines = classes
        .slice()
        .sort((a, b) => (a.period || 0) - (b.period || 0))
        .map((cls) => {
          const { total, done, pct } = classCompletion(cls.id);
          if (!total) return `• P${cls.period} ${cls.name}: no assignments yet (0%)`;
          if (pct >= 100) {
            return `• P${cls.period} ${cls.name}: ${pct}% — Finish Line Reached (${done}/${total})`;
          }
          return `• P${cls.period} ${cls.name}: ${pct}% (${done}/${total} complete)`;
        });
      return [
        "Here’s how close you are to done for each class:",
        ...lines,
        "",
        "Reading only counts after the Quick Check — finishing the pages alone doesn’t move the bar to complete.",
      ].join("\n");
    }

    if (/\b(add homework|new assignment|enter homework)\b/.test(lower)) {
      openHomeworkModal();
      return "Opening the homework form — fill that out and I’ll update your plan.";
    }

    const completed = tryCompleteFromChat(text);
    if (completed) return completed;

    // Long paste while not in checkpoint — attach to latest reading assignment
    if (text.trim().length > 200 && /[.!?]/.test(text)) {
      const reading = openAssignments().find((a) => a.workType === "reading");
      if (reading) {
        reading.readingText =
          (reading.readingText ? reading.readingText + "\n\n" : "") + text.trim();
        save();
        const cp = (reading.checkpoints || []).find((c) => !checkpointPassed(c));
        if (cp && cp.readingComplete) {
          return (
            `Saved that text to “${reading.title}.”\n\n` + beginCheckpoint(reading, cp)
          );
        }
        return `Saved that reading text to “${reading.title}.” Mark the reading block done when you’re ready for the Quick Check.`;
      }
    }

    if (openAssignments().length) {
      return "Ask “what’s next?”, “I’m behind”, “quick check”, or use Add Homework for something new.";
    }

    return "Tap Add Homework to enter an assignment. Then ask me what to do next anytime.";
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
        `Hey ${name}. Use Add Homework when you get an assignment — I’ll build today’s plan from your schedule. Ask me anytime what to do next, if you’re behind, or for a Quick Check.`
      );
    }
  }

  // ——— Focus Music (local Web Audio placeholder — no autoplay) ———

  function ensureMusicGraph() {
    if (focusMusic.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = focusMusic.volume * 0.22;
    master.connect(ctx.destination);

    // Soft brown-ish noise bed
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

    // Gentle looping pad tones (no melody / no vocals)
    const padGain = ctx.createGain();
    padGain.gain.value = 0.08;
    padGain.connect(master);
    const freqs = [174.61, 220.0, 261.63]; // soft F3–C4 cluster
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

  // ——— UI wiring ———

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
      `You’re set, ${state.profile.name}. Your classes and homework window are saved.\n\nTap Add Homework whenever you get an assignment — chat is here for “what’s next?”, Quick Checks, and when plans need adjusting.`
    );
    els.input?.focus();
  });

  els.addHomeworkBtn?.addEventListener("click", () => openHomeworkModal());
  els.editSetupBtn?.addEventListener("click", () => showSetup(true));
  document.getElementById("hw-type")?.addEventListener("change", toggleReadingFields);

  els.hwForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = addHomeworkFromForm();
    if (err) {
      els.hwError.hidden = false;
      els.hwError.textContent = err;
    }
  });

  document.getElementById("hw-reading-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      document.getElementById("hw-reading-text").value = text.trim();
    } catch {
      els.hwError.hidden = false;
      els.hwError.textContent = "Couldn’t read that file. Try pasting the text instead.";
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

  els.fileInput?.addEventListener("change", async () => {
    const file = els.fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      els.fileInput.value = "";
      if (text.trim().length < 40) {
        addMessage("bot", "That file looks too short. Try a .txt export of the reading section.");
        return;
      }
      handleUserMessage(text.trim());
    } catch {
      addMessage("bot", "I couldn’t read that file. Paste the text into the chat instead.");
    }
  });

  els.cpClose?.addEventListener("click", () => {
    closeCheckpointPanel();
    if (state.checkpoint?.phase !== "done") {
      addMessage(
        "bot",
        "Quick Check closed for now — it stays Pending until you finish it. No penalty."
      );
    }
    if (state.checkpoint?.phase !== "ask" && state.checkpoint?.phase !== "retry" && state.checkpoint?.phase !== "need_text") {
      state.checkpoint = null;
    }
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
