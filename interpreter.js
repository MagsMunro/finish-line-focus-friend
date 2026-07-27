/**
 * Finish Line Friend — conversational interpretation layer.
 * Pure functions (no DOM). Deterministic localInterpret by default.
 * Swap in an LLM via FINISH_LINE_LLM_INTERPRET(text, ctx) → same result shape.
 *
 * Result shape:
 * {
 *   intent: string,
 *   confidence: number,
 *   needsConfirmation: boolean,
 *   clarifyQuestion: string|null,
 *   drafts: AssignmentDraft[],
 *   slots: object,
 *   rationale: string
 * }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.FinishLineInterpreter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SCHEMA_VERSION = 1;

  const DAY_MAP = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    tues: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    thur: 4,
    thurs: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
  };

  const CLASS_SYNONYMS = [
    ["calculus", "calc", "calc bc", "calc ab", "precalc", "pre-calc", "math"],
    ["literature", "lit", "english", "ela", "lang arts", "language arts"],
    ["government", "gov", "govt", "civics", "apolgov", "ap gov"],
    ["biology", "bio"],
    ["chemistry", "chem"],
    ["physics", "phys"],
    ["history", "hist", "ush", "world history"],
    ["communications", "comm", "speech", "public speaking"],
    ["ensemble", "band", "wind", "orchestra", "choir", "music"],
    ["spanish", "espanol"],
    ["french"],
    ["computer science", "cs", "comp sci", "programming", "coding"],
    ["economics", "econ"],
    ["psychology", "psych"],
    ["statistics", "stats", "ap stats"],
  ];

  const WORK_PATTERNS = [
    {
      re: /\b(unit\s+)?test\b|\bexam\b|\bmidterm\b|\bfinal\b/i,
      kind: "test",
      title: "Test",
      minutes: 90,
      difficulty: "hard",
    },
    {
      re: /\bquiz\b/i,
      kind: "quiz",
      title: "Quiz",
      minutes: 40,
      difficulty: "medium",
    },
    {
      re: /\bessay\b|\bpaper\b|\bresearch paper\b/i,
      kind: "essay",
      title: "Essay",
      minutes: 120,
      difficulty: "hard",
    },
    {
      re: /\bproject\b|\bpresentation\b|\blab report\b/i,
      kind: "project",
      title: "Project",
      minutes: 120,
      difficulty: "hard",
    },
    {
      re: /\bworksheet\b|\bproblem set\b|\bproblems?\b|\bhw\b|\bhomework\b|\bassignment\b|\breading\b|\bchapter\b/i,
      kind: "homework",
      title: "Homework",
      minutes: 45,
      difficulty: "medium",
    },
  ];

  function parseIso(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function toIso(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function addDaysIso(iso, n) {
    const dt = parseIso(iso);
    dt.setDate(dt.getDate() + n);
    return toIso(dt);
  }

  function weekdayOf(iso) {
    return parseIso(iso).getDay();
  }

  function nextWeekday(todayIso, targetDow) {
    const cur = weekdayOf(todayIso);
    // "Friday" on Friday means today; otherwise the next matching weekday.
    const delta = (targetDow - cur + 7) % 7;
    return addDaysIso(todayIso, delta);
  }

  function extractDueDate(text, todayIso) {
    const lower = text.toLowerCase();
    if (/\b(today|tonight)\b/.test(lower)) {
      return { dueDate: todayIso, confidence: 0.95 };
    }
    if (/\btomorrow\b/.test(lower)) {
      return { dueDate: addDaysIso(todayIso, 1), confidence: 0.95 };
    }
    const weeks = lower.match(
      /\b(?:in|for)\s+(\d+)\s+weeks?\b|\bnot due for\s+(\d+)\s+weeks?\b|\bisn'?t due for\s+(\d+)\s+weeks?\b|\b(?:in|for)\s+two weeks?\b|\bnot due for two weeks?\b|\bisn'?t due for two weeks?\b/
    );
    if (weeks) {
      const n =
        Number(weeks[1] || weeks[2] || weeks[3]) ||
        (/\btwo weeks?\b/.test(weeks[0]) ? 2 : 0);
      if (n > 0) return { dueDate: addDaysIso(todayIso, n * 7), confidence: 0.9 };
    }
    const inDays = lower.match(/\bin\s+(\d+)\s+days?\b/);
    if (inDays) {
      return { dueDate: addDaysIso(todayIso, Number(inDays[1])), confidence: 0.9 };
    }
    const nextWd = lower.match(
      /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/
    );
    if (nextWd) {
      const dow = DAY_MAP[nextWd[1]];
      let due = nextWeekday(todayIso, dow);
      // ensure at least 7 days out for "next Friday"
      if (daysBetween(todayIso, due) < 7) due = addDaysIso(due, 7);
      return { dueDate: due, confidence: 0.85 };
    }
    for (const [name, dow] of Object.entries(DAY_MAP)) {
      if (name.length < 3) continue;
      const re = new RegExp(`\\b${name}\\b`);
      if (re.test(lower)) {
        return { dueDate: nextWeekday(todayIso, dow), confidence: 0.9 };
      }
    }
    // Month day: March 12 / 3/12 / 2026-03-12
    const iso = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (iso) return { dueDate: iso[1], confidence: 1 };
    const md = lower.match(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/
    );
    if (md) {
      const months = {
        jan: 0,
        january: 0,
        feb: 1,
        february: 1,
        mar: 2,
        march: 2,
        apr: 3,
        april: 3,
        may: 4,
        jun: 5,
        june: 5,
        jul: 6,
        july: 6,
        aug: 7,
        august: 7,
        sep: 8,
        sept: 8,
        september: 8,
        oct: 9,
        october: 9,
        nov: 10,
        november: 10,
        dec: 11,
        december: 11,
      };
      const mi = months[md[1]];
      const day = Number(md[2]);
      const base = parseIso(todayIso);
      let dt = new Date(base.getFullYear(), mi, day);
      if (dt < base) dt = new Date(base.getFullYear() + 1, mi, day);
      return { dueDate: toIso(dt), confidence: 0.85 };
    }
    const slash = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (slash) {
      const base = parseIso(todayIso);
      let y = slash[3] ? Number(slash[3]) : base.getFullYear();
      if (y < 100) y += 2000;
      let dt = new Date(y, Number(slash[1]) - 1, Number(slash[2]));
      if (!slash[3] && dt < base) dt = new Date(y + 1, Number(slash[1]) - 1, Number(slash[2]));
      return { dueDate: toIso(dt), confidence: 0.8 };
    }
    return { dueDate: null, confidence: 0 };
  }

  function daysBetween(a, b) {
    const ms = parseIso(b) - parseIso(a);
    return Math.round(ms / 86400000);
  }

  function scoreClassMatch(text, cls) {
    const lower = text.toLowerCase();
    let best = 0;
    const candidates = [cls.name, ...(cls.aliases || [])].map((s) => String(s).toLowerCase());
    for (const c of candidates) {
      if (c && lower.includes(c)) best = Math.max(best, Math.min(1, c.length / 8));
    }
    for (const group of CLASS_SYNONYMS) {
      // Link class↔synonym only via real substring overlap (min 3 chars), not tiny tokens like "ap".
      const matchedSyn = group.find((g) =>
        candidates.some((c) => c === g || (g.length >= 3 && c.includes(g)) || (c.length >= 4 && g.includes(c)))
      );
      if (!matchedSyn) continue;
      const textHit = group.some((g) =>
        new RegExp(`\\b${g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)
      );
      if (!textHit) continue;
      // Prefer the synonym actually present in the utterance when scoring ties.
      const uttered = group.filter((g) =>
        new RegExp(`\\b${g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)
      );
      const specificity = uttered.some((g) => candidates.some((c) => c.includes(g) || g.includes(c)))
        ? 0.95
        : 0.8;
      best = Math.max(best, specificity);
    }
    return best;
  }

  function findClassesInText(text, classes) {
    const scored = (classes || [])
      .map((cls) => ({ cls, score: scoreClassMatch(text, cls) }))
      .filter((x) => x.score > 0.35)
      .sort((a, b) => b.score - a.score);
    return scored;
  }

  function detectWork(text) {
    for (const p of WORK_PATTERNS) {
      if (p.re.test(text)) return p;
    }
    return null;
  }

  function buildTitle(clause, work, className) {
    let cleaned = clause
      .replace(/\b(i have|i've got|i got|gotta|got to|need to|we have|there's|there is|due|by|on)\b/gi, " ")
      .replace(
        /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|next\s+\w+)\b/gi,
        " "
      )
      .replace(
        /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/gi,
        " "
      )
      .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
      .replace(/\b\d+\s*(?:min|mins|minutes|hours?|hrs?)\b/gi, " ")
      .replace(/\bit'?s like\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length >= 3 && !/^(a|an|the|my|our)$/i.test(cleaned)) {
      let t = cleaned;
      if (className) {
        const re = new RegExp(className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
        t = t.replace(re, " ").replace(/\s+/g, " ").trim();
      }
      for (const group of CLASS_SYNONYMS) {
        for (const g of group) {
          t = t.replace(new RegExp(`\\b${g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
        }
      }
      t = t.replace(/\s+/g, " ").trim();
      t = t.replace(/^(a|an|the|my|our|do|my)\s+/i, "").trim();
      if (t.length >= 2) {
        return t.replace(/^\w/, (c) => c.toUpperCase());
      }
    }
    const label = work?.title || "Assignment";
    return className ? `${className.split(/\s+/).slice(-2).join(" ")} ${label}` : label;
  }

  function splitClauses(text) {
    // Split multi-item statements without shredding trailing asides.
    const parts = text
      .split(/\s*(?:,|(?:\band\b(?!\s+i\s+haven'?t))|;|\balso\b|\bplus\b)\s*/i)
      .map((p) => p.trim())
      .filter((p) => p && !/^i\s+haven'?t\s+started\.?$/i.test(p));
    if (parts.length <= 1) return [text.trim()];
    const worky = parts.filter(
      (p) => detectWork(p) || /\bdue\b|\btest\b|\bessay\b|\bhomework\b|\bproject\b|\bquiz\b|\bpresentation\b/i.test(p)
    );
    if (worky.length >= 2) return parts.filter((p) => p.length > 2);
    return [text.trim()];
  }

  function draftFromClause(clause, ctx) {
    const classes = ctx.classes || [];
    const matches = findClassesInText(clause, classes);
    const work = detectWork(clause);
    const due = extractDueDate(clause, ctx.today);
    const minutesMatch = clause.match(/\b(\d+)\s*(?:min|mins|minutes|hours?|hrs?)\b/i);
    let minutes = work?.minutes || 45;
    let difficulty = work?.difficulty || "medium";
    if (minutesMatch) {
      let n = Number(minutesMatch[1]);
      if (/hour|hr/i.test(minutesMatch[0])) n *= 60;
      minutes = Math.max(5, Math.min(600, n));
    }
    if (/\b(hard|tough|long)\b/i.test(clause)) difficulty = "hard";
    if (/\b(easy|quick|short)\b/i.test(clause)) difficulty = "easy";

    const missing = [];
    let classId = null;
    let className = null;
    let classConfidence = 0;
    if (matches.length === 1 || (matches[0] && matches[0].score >= 0.8 && (!matches[1] || matches[0].score - matches[1].score >= 0.15))) {
      classId = matches[0].cls.id;
      className = matches[0].cls.name;
      classConfidence = matches[0].score;
    } else if (matches.length > 1) {
      missing.push("class");
      classConfidence = matches[0].score;
    } else if (work || due.dueDate) {
      missing.push("class");
    }

    if (!due.dueDate) missing.push("dueDate");
    if (!work && !classId && missing.length) {
      // not really an assignment clause
    }

    const title = buildTitle(clause, work, className);
    return {
      classId,
      className,
      title,
      dueDate: due.dueDate,
      minutes,
      difficulty,
      notes: "",
      missing,
      confidence: Math.min(
        1,
        (work ? 0.35 : 0.1) + classConfidence * 0.4 + (due.dueDate ? due.confidence * 0.35 : 0)
      ),
      sourceText: clause,
    };
  }

  function looksLikeAdd(text) {
    const lower = text.toLowerCase();
    if (
      /\b(i have|i've got|i got|we have|need to|gotta|got to|assigned|due|test|quiz|essay|paper|project|presentation|homework|hw|worksheet|problem set)\b/.test(
        lower
      )
    ) {
      return true;
    }
    if (detectWork(text) && extractDueDate(text, "2026-01-01").dueDate) return true;
    return false;
  }

  function looksLikeComplete(text) {
    return /\b(finished|finishing|completed|complete|done with|just finished|checked off|turned in|submitted|handed in)\b/i.test(
      text
    );
  }

  function looksLikeOverwhelmed(text) {
    return /\b(overwhelmed|stressed|too much|can't do this|cannot do this|drowning|behind|freaking out|anxious about (my )?work|so much (work|homework))\b/i.test(
      text
    );
  }

  function looksLikeWhatsNext(text) {
    return /\b(what should i (do|work on)|what('?s| is) next|what now|what do i (do|work on)|help me (start|prioritize)|tonight'?s plan|what can i do)\b/i.test(
      text
    );
  }

  function looksLikeTimeBox(text) {
    return /\b(only have|i have)\s+(\d+)\s*(min|mins|minutes)\b/i.test(text) || /\b(\d+)\s*(min|mins|minutes)\s+(only|left|free)\b/i.test(text);
  }

  function looksLikeStop(text) {
    return /\b(stop for today|done for today|call it (a night|for today)|going to bed|i'?m done for (the )?night)\b/i.test(
      text
    );
  }

  function looksLikeReschedule(text) {
    return /\b(move|push|delay|reschedule|do (it|that) tomorrow|skip (it|that) tonight)\b/i.test(text);
  }

  function looksLikeDueCorrection(text) {
    return (
      /\b(actually|wait[, ]|correction)\b/i.test(text) ||
      /\bnot\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/i.test(
        text
      )
    );
  }

  function extractCorrectedDueDate(text, todayIso) {
    const lower = text.toLowerCase();
    const isDay = lower.match(
      /\bis\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/
    );
    if (isDay) return nextWeekday(todayIso, DAY_MAP[isDay[1]]);
    // Remove "not <weekday>" then parse remaining weekday.
    const stripped = lower.replace(
      /\bnot\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/g,
      " "
    );
    return extractDueDate(stripped, todayIso).dueDate;
  }

  function looksLikeProgress(text) {
    return /\b(finish line|how close|progress|am i caught up|how am i doing)\b/i.test(text);
  }

  function looksLikeAffirm(text) {
    return /^(yes|yeah|yep|yup|ok|okay|sure|correct|right|do it|add (them|it)|sounds good|go ahead|please)\b/i.test(
      text.trim()
    );
  }

  function looksLikeDeny(text) {
    return /^(no|nope|nah|cancel|stop|don'?t|do not|wait)\b/i.test(text.trim());
  }

  function matchOpenAssignment(text, openAssignments, todayIso) {
    const lower = text.toLowerCase();
    const scored = (openAssignments || []).map((a) => {
      let score = 0;
      if (a.className && lower.includes(String(a.className).toLowerCase())) score += 0.5;
      for (const group of CLASS_SYNONYMS) {
        const nameHit = group.some((g) => String(a.className || "").toLowerCase().includes(g));
        const textHit = group.some((g) => new RegExp(`\\b${g}\\b`, "i").test(lower));
        if (nameHit && textHit) score += 0.45;
      }
      const title = String(a.title || "").toLowerCase();
      for (const word of title.split(/\s+/)) {
        if (word.length > 3 && lower.includes(word)) score += 0.15;
      }
      if (/\b(assignment|homework|hw)\b/.test(lower) && /\b(assignment|homework|events?|paragraph|post)\b/.test(title)) {
        score += 0.1;
      }
      return { a, score };
    });
    scored.sort((x, y) => y.score - x.score);
    if (!scored.length || scored[0].score < 0.4) return { matches: [], confidence: 0 };
    let top = scored.filter((s) => s.score >= scored[0].score - 0.1 && s.score >= 0.4);
    // Tie-break: soonest due date (due today / tomorrow over far-future projects).
    if (top.length > 1) {
      top = [...top].sort((x, y) => String(x.a.dueDate).localeCompare(String(y.a.dueDate)));
      if (top[0].a.dueDate !== top[1].a.dueDate) {
        return { matches: [top[0].a], confidence: scored[0].score };
      }
    }
    return { matches: top.map((t) => t.a), confidence: scored[0].score };
  }

  function localInterpret(text, ctx = {}) {
    const raw = String(text || "").trim();
    const today = ctx.today || toIso(new Date());
    if (!raw) {
      return {
        intent: "unknown",
        confidence: 0,
        needsConfirmation: false,
        clarifyQuestion: null,
        drafts: [],
        slots: {},
        rationale: "empty",
      };
    }

    if (ctx.pending) {
      if (looksLikeAffirm(raw)) {
        return {
          intent: "affirm",
          confidence: 0.95,
          needsConfirmation: false,
          clarifyQuestion: null,
          drafts: [],
          slots: { pending: ctx.pending },
          rationale: "affirm pending",
        };
      }
      if (looksLikeDeny(raw)) {
        return {
          intent: "deny",
          confidence: 0.95,
          needsConfirmation: false,
          clarifyQuestion: null,
          drafts: [],
          slots: { pending: ctx.pending },
          rationale: "deny pending",
        };
      }
    }

    if (/^(hi|hello|hey|yo)\b/i.test(raw)) {
      return {
        intent: "greeting",
        confidence: 0.9,
        needsConfirmation: false,
        clarifyQuestion: null,
        drafts: [],
        slots: {},
        rationale: "greeting",
      };
    }

    if (/\b(help|what can you do)\b/i.test(raw) && raw.length < 40) {
      return {
        intent: "help",
        confidence: 0.85,
        needsConfirmation: false,
        clarifyQuestion: null,
        drafts: [],
        slots: {},
        rationale: "help",
      };
    }

    if (/\b(add homework|open (the )?form|enter (it )?manually)\b/i.test(raw)) {
      return {
        intent: "open_form",
        confidence: 0.9,
        needsConfirmation: false,
        clarifyQuestion: null,
        drafts: [],
        slots: {},
        rationale: "open form",
      };
    }

    if (looksLikeDueCorrection(raw)) {
      const classHits = findClassesInText(raw, ctx.classes || []);
      const dueDate = extractCorrectedDueDate(raw, today);
      const work = detectWork(raw);
      if (dueDate && (classHits.length || work)) {
        const opens = ctx.openAssignments || [];
        let target = null;
        if (classHits.length) {
          const cid = classHits[0].cls.id;
          const cands = opens.filter((a) => a.classId === cid);
          if (work) {
            target =
              cands.find((a) => new RegExp(work.kind === "test" ? "test|exam" : work.title, "i").test(a.title)) ||
              null;
          }
          if (!target && cands.length === 1) target = cands[0];
          if (!target && cands.length > 1) {
            // Prefer the one whose current due matches a "not <day>" mention, else soonest.
            const notDay = raw.toLowerCase().match(
              /\bnot\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/
            );
            if (notDay) {
              const wrongDue = nextWeekday(today, DAY_MAP[notDay[1]]);
              target = cands.find((a) => a.dueDate === wrongDue) || null;
            }
            if (!target) {
              target = [...cands].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];
            }
          }
        }
        if (target) {
          return {
            intent: "update_due",
            confidence: 0.88,
            needsConfirmation: false,
            clarifyQuestion: null,
            drafts: [],
            slots: { assignmentId: target.id, dueDate, title: target.title },
            rationale: "due correction",
          };
        }
        return {
          intent: "update_due",
          confidence: 0.55,
          needsConfirmation: true,
          clarifyQuestion: "Which assignment should I move to that due date?",
          drafts: [],
          slots: {
            classId: classHits[0]?.cls?.id || null,
            dueDate,
          },
          rationale: "due correction needs target",
        };
      }
    }

    if (looksLikeComplete(raw)) {
      const { matches, confidence } = matchOpenAssignment(raw, ctx.openAssignments, today);
      if (matches.length === 1) {
        return {
          intent: "complete",
          confidence,
          needsConfirmation: false,
          clarifyQuestion: null,
          drafts: [],
          slots: { assignmentId: matches[0].id, title: matches[0].title },
          rationale: "complete single match",
        };
      }
      if (matches.length > 1) {
        return {
          intent: "complete",
          confidence: confidence * 0.7,
          needsConfirmation: true,
          clarifyQuestion: `Which one did you finish — ${matches
            .slice(0, 3)
            .map((m) => `“${m.title}” (${m.className})`)
            .join(" or ")}?`,
          drafts: [],
          slots: { candidates: matches.map((m) => m.id) },
          rationale: "complete ambiguous",
        };
      }
      return {
        intent: "complete",
        confidence: 0.45,
        needsConfirmation: true,
        clarifyQuestion: "Which assignment did you finish? Name the class or title.",
        drafts: [],
        slots: {},
        rationale: "complete no match",
      };
    }

    if (looksLikeWhatsNext(raw)) {
      return {
        intent: "whats_next",
        confidence: 0.9,
        needsConfirmation: false,
        clarifyQuestion: null,
        drafts: [],
        slots: {},
        rationale: "whats next",
      };
    }

    if (looksLikeOverwhelmed(raw)) {
      return {
        intent: "overwhelmed",
        confidence: 0.9,
        needsConfirmation: false,
        clarifyQuestion: null,
        drafts: [],
        slots: {},
        rationale: "overwhelmed",
      };
    }

    if (looksLikeTimeBox(raw)) {
      const m = raw.match(/(\d+)\s*(min|mins|minutes)/i);
      return {
        intent: "time_box",
        confidence: 0.9,
        needsConfirmation: false,
        clarifyQuestion: null,
        drafts: [],
        slots: { minutes: m ? Number(m[1]) : 30 },
        rationale: "time box",
      };
    }

    if (looksLikeStop(raw)) {
      return {
        intent: "stop_today",
        confidence: 0.9,
        needsConfirmation: false,
        clarifyQuestion: null,
        drafts: [],
        slots: {},
        rationale: "stop today",
      };
    }

    if (looksLikeReschedule(raw)) {
      return {
        intent: "reschedule",
        confidence: 0.75,
        needsConfirmation: false,
        clarifyQuestion: null,
        drafts: [],
        slots: {},
        rationale: "reschedule",
      };
    }

    if (looksLikeProgress(raw)) {
      return {
        intent: "progress",
        confidence: 0.85,
        needsConfirmation: false,
        clarifyQuestion: null,
        drafts: [],
        slots: {},
        rationale: "progress",
      };
    }

    if (/\b(today'?s plan|show (my )?plan|what'?s (on )?my (plan|schedule))\b/i.test(raw)) {
      return {
        intent: "show_plan",
        confidence: 0.85,
        needsConfirmation: false,
        clarifyQuestion: null,
        drafts: [],
        slots: {},
        rationale: "show plan",
      };
    }

    if (looksLikeAdd(raw)) {
      const clauses = splitClauses(raw);
      const drafts = clauses.map((c) => draftFromClause(c, { ...ctx, today })).filter((d) => {
        return d.classId || d.dueDate || detectWork(d.sourceText) || d.title.length > 3;
      });
      // Drop empty noise clauses
      const usable = drafts.filter(
        (d) => d.classId || d.dueDate || detectWork(d.sourceText)
      );
      if (!usable.length) {
        return {
          intent: "add_work",
          confidence: 0.4,
          needsConfirmation: true,
          clarifyQuestion:
            "I can add that — which class is it for, and when is it due?",
          drafts: [],
          slots: {},
          rationale: "add unclear",
        };
      }

      const anyMissing = usable.some((d) => d.missing.length);
      const multi = usable.length > 1;
      const lowConf = usable.some((d) => d.confidence < 0.55);
      const needsConfirmation = multi || anyMissing || lowConf;

      let clarifyQuestion = null;
      if (usable.some((d) => d.missing.includes("class"))) {
        clarifyQuestion = "Which class is that for?";
      } else if (usable.some((d) => d.missing.includes("dueDate"))) {
        clarifyQuestion = "When is it due?";
      } else if (multi) {
        clarifyQuestion = null; // confirmation summary handled by app
      }

      return {
        intent: "add_work",
        confidence: usable.reduce((s, d) => s + d.confidence, 0) / usable.length,
        needsConfirmation,
        clarifyQuestion,
        drafts: usable,
        slots: {},
        rationale: multi ? "add multi" : "add single",
      };
    }

    return {
      intent: "unknown",
      confidence: 0.2,
      needsConfirmation: false,
      clarifyQuestion: null,
      drafts: [],
      slots: {},
      rationale: "unknown",
    };
  }

  /**
   * Public entry. Uses FINISH_LINE_LLM_INTERPRET when provided (browser global or ctx.llmInterpret).
   */
  async function interpret(text, ctx = {}) {
    const llm =
      ctx.llmInterpret ||
      (typeof globalThis !== "undefined" && globalThis.FINISH_LINE_LLM_INTERPRET);
    if (typeof llm === "function") {
      try {
        const result = await llm(text, ctx);
        if (result && result.intent) {
          return { schemaVersion: SCHEMA_VERSION, source: "llm", ...result };
        }
      } catch {
        /* fall back */
      }
    }
    return { schemaVersion: SCHEMA_VERSION, source: "local", ...localInterpret(text, ctx) };
  }

  return {
    SCHEMA_VERSION,
    interpret,
    localInterpret,
    extractDueDate,
    splitClauses,
    findClassesInText,
    detectWork,
  };
});
