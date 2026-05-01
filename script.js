// ════════════════════════════════════════════════
// QuizCore · script.js  (CORS-fixed: uses JSONP)
// ════════════════════════════════════════════════

const API_BASE_URL = "https://script.google.com/macros/s/AKfycbxH0TV6E11pgoo0XgA8KzE5NVZfLvC_LchxS0AawsUhIhrY-hM_IKvkyrUXOr55fwu7-w/exec";

// ── JSONP ────────────────────────────────────────
let _jsonpCounter = 0;
function jsonp(params) {
  return new Promise((resolve, reject) => {
    const cbName = `_qcb${++_jsonpCounter}`;
    const timeout = setTimeout(() => {
      delete window[cbName];
      document.getElementById(`jsonp-${cbName}`)?.remove();
      reject(new Error("Request timed out"));
    }, 12000);

    window[cbName] = (data) => {
      clearTimeout(timeout);
      delete window[cbName];
      document.getElementById(`jsonp-${cbName}`)?.remove();
      resolve(data);
    };

    const url = new URL(API_BASE_URL);
    url.searchParams.set("callback", cbName);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const script = document.createElement("script");
    script.id    = `jsonp-${cbName}`;
    script.src   = url.toString();
    script.onerror = () => {
      clearTimeout(timeout);
      delete window[cbName];
      script.remove();
      reject(new Error("Script load failed — check your Apps Script URL"));
    };
    document.head.appendChild(script);
  });
}

// ── State ────────────────────────────────────────
const state = {
  questions:     [],
  currentIndex:  0,
  score:         0,
  sessionId:     null,
  timerInterval: null,
  timeLeft:      0,
  answered:      false,
  startTime:     null,
  // per-question: { questionId, correct, correctAnswer, selected, skipped }
  history:       [],
};

// ── DOM ──────────────────────────────────────────
const screens = {
  loading: document.getElementById("screen-loading"),
  start:   document.getElementById("screen-start"),
  quiz:    document.getElementById("screen-quiz"),
  results: document.getElementById("screen-results"),
  error:   document.getElementById("screen-error"),
};

const el = {
  btnStart:     document.getElementById("btn-start"),
  btnRetry:     document.getElementById("btn-retry"),
  btnRestart:   document.getElementById("btn-restart"),
  qCounter:     document.getElementById("q-counter"),
  qCategory:    document.getElementById("q-category"),
  qDifficulty:  document.getElementById("q-difficulty"),
  questionText: document.getElementById("question-text"),
  quizBody:     document.getElementById("quiz-body"),
  optionBtns:   document.querySelectorAll(".option-btn"),
  progressBar:  document.getElementById("progress-bar"),
  timerArc:     document.getElementById("timer-arc"),
  timerNum:     document.getElementById("timer-num"),
  finalScore:   document.getElementById("final-score"),
  scoreDenom:   document.getElementById("score-denom"),
  resultsEmoji: document.getElementById("results-emoji"),
  resultsTitle: document.getElementById("results-title"),
  statAccuracy: document.getElementById("stat-accuracy"),
  statCorrect:  document.getElementById("stat-correct"),
  statWrong:    document.getElementById("stat-wrong"),
  statSkipped:  document.getElementById("stat-skipped"),
  breakdown:    document.getElementById("breakdown"),
  errorMsg:     document.getElementById("error-msg"),
};

const CIRCUMFERENCE = 2 * Math.PI * 44;

// ── Screens ──────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[name].classList.add("active");
}

// ── Init ─────────────────────────────────────────
async function init() {
  showScreen("loading");
  try {
    const qData = await jsonp({ action: "getQuestions" });
    if (!qData.success || !qData.questions?.length)
      throw new Error(qData.error || "No questions returned from sheet.");
    state.questions = qData.questions;

    const sData = await jsonp({ action: "initSession" });
    state.sessionId = sData.sessionId || "local-" + Date.now();

    showScreen("start");
  } catch (err) {
    el.errorMsg.textContent = err.message;
    showScreen("error");
  }
}

// ── Start ────────────────────────────────────────
function startQuiz() {
  state.currentIndex = 0;
  state.score        = 0;
  state.answered     = false;
  state.history      = [];
  state.startTime    = Date.now();
  loadQuestion();
  showScreen("quiz");
}

// ── Load question ────────────────────────────────
function loadQuestion() {
  const q = state.questions[state.currentIndex];
  if (!q) { showResults(); return; }

  state.answered = false;

  const num   = state.currentIndex + 1;
  const total = state.questions.length;

  el.qCounter.textContent    = `${String(num).padStart(2,"0")} / ${String(total).padStart(2,"0")}`;
  el.qCategory.textContent   = q.category   || "General";
  el.qDifficulty.textContent = q.difficulty || "Medium";
  el.progressBar.style.width = `${((num - 1) / total) * 100}%`;
  el.questionText.textContent = q.question;

  // Reset option buttons
  el.optionBtns.forEach(btn => {
    btn.querySelector(".opt-text").textContent = q.options[btn.dataset.key] || "";
    btn.className = "option-btn";
    btn.disabled  = false;
    btn.style.pointerEvents = "";
  });

  // Animate in
  el.quizBody.classList.remove("slide-out");
  el.quizBody.classList.add("slide-in");
  setTimeout(() => el.quizBody.classList.remove("slide-in"), 350);

  startTimer(q.timeLimit || 20);
}

// ── Timer ────────────────────────────────────────
function startTimer(seconds) {
  clearInterval(state.timerInterval);
  state.timeLeft = seconds;
  updateTimerUI(seconds, seconds);

  state.timerInterval = setInterval(() => {
    state.timeLeft--;
    updateTimerUI(state.timeLeft, seconds);
    if (state.timeLeft <= 0) {
      clearInterval(state.timerInterval);
      handleTimeout();
    }
  }, 1000);
}

function updateTimerUI(left, total) {
  el.timerNum.textContent = left;
  const pct = left / total;
  el.timerArc.style.strokeDashoffset = CIRCUMFERENCE * (1 - pct);
  el.timerArc.classList.toggle("danger", pct < 0.35);
}

function stopTimer() { clearInterval(state.timerInterval); }

// ── Timeout (auto-advance) ────────────────────────
async function handleTimeout() {
  if (state.answered) return;
  state.answered = true;
  disableOptions();

  // Flash the whole quiz body red briefly
  el.quizBody.classList.add("flash-timeout");
  setTimeout(() => el.quizBody.classList.remove("flash-timeout"), 500);

  // Submit skipped answer in background (don't await — advance immediately)
  const q       = state.questions[state.currentIndex];
  const isFinal = state.currentIndex === state.questions.length - 1;
  state.history.push({ questionId: q.id, correct: false, correctAnswer: null, selected: null, skipped: true });

  jsonp({
    action: "submitAnswer",
    sessionId:      state.sessionId,
    questionId:     q.id,
    selectedOption: "",
    isFinal:        String(isFinal),
  }).then(data => {
    // Patch correctAnswer into history after server responds
    const entry = state.history.find(h => h.questionId === q.id && h.skipped);
    if (entry) entry.correctAnswer = data.correctAnswer;
  }).catch(() => {});

  advanceAfterDelay(500);
}

// ── Answer click ──────────────────────────────────
el.optionBtns.forEach(btn => {
  btn.addEventListener("click", () => handleAnswer(btn.dataset.key, btn));
});

async function handleAnswer(selected, clickedBtn) {
  if (state.answered) return;
  state.answered = true;
  stopTimer();
  disableOptions();

  const q       = state.questions[state.currentIndex];
  const isFinal = state.currentIndex === state.questions.length - 1;

  // Optimistic: highlight selected immediately
  clickedBtn.classList.add("selected");

  try {
    const data = await jsonp({
      action:         "submitAnswer",
      sessionId:      state.sessionId,
      questionId:     q.id,
      selectedOption: selected,
      isFinal:        String(isFinal),
    });

    state.score = data.score ?? state.score;

    // Flash correct/incorrect color on the chosen button, then advance
    if (data.correct) {
      clickedBtn.classList.remove("selected");
      clickedBtn.classList.add("correct");
      el.quizBody.classList.add("flash-correct");
      setTimeout(() => el.quizBody.classList.remove("flash-correct"), 500);
    } else {
      clickedBtn.classList.remove("selected");
      clickedBtn.classList.add("incorrect");
      // Also reveal correct answer
      el.optionBtns.forEach(b => {
        if (b.dataset.key === data.correctAnswer) b.classList.add("correct");
      });
      el.quizBody.classList.add("flash-incorrect");
      setTimeout(() => el.quizBody.classList.remove("flash-incorrect"), 500);
    }

    state.history.push({
      questionId:    q.id,
      correct:       data.correct,
      correctAnswer: data.correctAnswer,
      selected,
      skipped:       false,
    });

    advanceAfterDelay(600);

  } catch (err) {
    // On network error: log skipped, move on
    state.history.push({ questionId: q.id, correct: false, correctAnswer: null, selected, skipped: false });
    el.quizBody.classList.add("flash-timeout");
    setTimeout(() => el.quizBody.classList.remove("flash-timeout"), 500);
    advanceAfterDelay(600);
  }
}

function disableOptions() {
  el.optionBtns.forEach(btn => {
    btn.disabled = true;
    btn.style.pointerEvents = "none";
  });
}

// ── Advance ───────────────────────────────────────
function advanceAfterDelay(ms) {
  setTimeout(() => {
    // Slide out current question
    el.quizBody.classList.add("slide-out");
    setTimeout(() => {
      state.currentIndex++;
      el.progressBar.style.width = `${(state.currentIndex / state.questions.length) * 100}%`;
      if (state.currentIndex >= state.questions.length) showResults();
      else loadQuestion();
    }, 280);
  }, ms);
}

// ── Results ───────────────────────────────────────
function showResults() {
  stopTimer();

  const total   = state.questions.length;
  const correct = state.history.filter(h => h.correct).length;
  const wrong   = state.history.filter(h => !h.correct && !h.skipped).length;
  const skipped = state.history.filter(h => h.skipped).length;
  const pct     = total > 0 ? Math.round((correct / total) * 100) : 0;

  // Animated score count-up
  el.scoreDenom.textContent = `/${total}`;
  animateCount(el.finalScore, 0, correct, 800);

  el.statAccuracy.textContent = pct + "%";
  el.statCorrect.textContent  = correct;
  el.statWrong.textContent    = wrong;
  el.statSkipped.textContent  = skipped;

  const { emoji, title } = gradeResult(correct / total);
  el.resultsEmoji.textContent = emoji;
  el.resultsTitle.textContent = title;

  // Breakdown rows
  el.breakdown.innerHTML = "";
  state.history.forEach((h, i) => {
    const q   = state.questions[i];
    const row = document.createElement("div");
    row.className = "bd-row";

    const statusIcon = h.skipped ? "⏱" : h.correct ? "✓" : "✕";
    const statusClass = h.skipped ? "skip" : h.correct ? "ok" : "bad";
    const answerNote = h.skipped
      ? (h.correctAnswer ? `Ans: ${h.correctAnswer}` : "–")
      : h.correct
        ? h.selected
        : `${h.selected || "–"} → ${h.correctAnswer || "?"}`;

    row.innerHTML = `
      <span class="bd-status ${statusClass}">${statusIcon}</span>
      <span class="bd-label">${(q?.question || "Q"+(i+1)).slice(0, 44)}…</span>
      <span class="bd-ans ${statusClass}">${answerNote}</span>
    `;
    el.breakdown.appendChild(row);
  });

  showScreen("results");
}

function animateCount(el, from, to, duration) {
  const start = performance.now();
  const update = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    el.textContent = Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

function gradeResult(pct) {
  if (pct === 1)   return { emoji: "🏆", title: "Perfect Score!" };
  if (pct >= 0.8)  return { emoji: "🌟", title: "Excellent!" };
  if (pct >= 0.6)  return { emoji: "👍", title: "Well Done!" };
  if (pct >= 0.4)  return { emoji: "📚", title: "Keep Learning" };
  return             { emoji: "💪", title: "Don't Give Up!" };
}

// ── Event listeners ───────────────────────────────
el.btnStart.addEventListener("click", startQuiz);

el.btnRestart.addEventListener("click", async () => {
  showScreen("loading");
  try {
    const sData = await jsonp({ action: "initSession" });
    state.sessionId = sData.sessionId || "local-" + Date.now();
  } catch { /* play without new session */ }
  startQuiz();
});

el.btnRetry.addEventListener("click", init);

// ── Boot ──────────────────────────────────────────
init();
