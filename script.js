// ════════════════════════════════════════════════
// QuizCore · script.js  (CORS-fixed: uses JSONP)
// Replace API_BASE_URL with your deployed Apps Script URL
// ════════════════════════════════════════════════

const API_BASE_URL = "https://script.google.com/macros/s/AKfycbxH0TV6E11pgoo0XgA8KzE5NVZfLvC_LchxS0AawsUhIhrY-hM_IKvkyrUXOr55fwu7-w/exec";

// ── JSONP helper ─────────────────────────────────
// Apps Script blocks fetch() via CORS. JSONP injects a <script> tag instead —
// no preflight, no CORS headers needed, works from any origin including file://
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
    script.id  = `jsonp-${cbName}`;
    script.src = url.toString();
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
  history:       [],
};

// ── DOM refs ─────────────────────────────────────
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
  optionBtns:   document.querySelectorAll(".option-btn"),
  progressBar:  document.getElementById("progress-bar"),
  timerArc:     document.getElementById("timer-arc"),
  timerNum:     document.getElementById("timer-num"),
  liveScore:    document.getElementById("live-score"),
  feedbackBar:  document.getElementById("feedback-bar"),
  feedbackIcon: document.getElementById("feedback-icon"),
  feedbackText: document.getElementById("feedback-text"),
  finalScore:   document.getElementById("final-score"),
  resultsEmoji: document.getElementById("results-emoji"),
  resultsTitle: document.getElementById("results-title"),
  resultsMsg:   document.getElementById("results-msg"),
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
    // 1. Load questions (correct answers NOT included in response)
    const qData = await jsonp({ action: "getQuestions" });
    if (!qData.success || !qData.questions?.length) {
      throw new Error(qData.error || "No questions returned from sheet.");
    }
    state.questions = qData.questions;

    // 2. Create a session
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
  el.liveScore.textContent = "0";
  loadQuestion();
  showScreen("quiz");
}

// ── Load question ────────────────────────────────
function loadQuestion() {
  const q = state.questions[state.currentIndex];
  if (!q) { showResults(); return; }

  state.answered = false;
  hideFeedback();

  const num   = state.currentIndex + 1;
  const total = state.questions.length;
  el.qCounter.textContent     = `${String(num).padStart(2,"0")} / ${String(total).padStart(2,"0")}`;
  el.qCategory.textContent    = q.category   || "General";
  el.qDifficulty.textContent  = q.difficulty || "Medium";
  el.progressBar.style.width  = `${((num - 1) / total) * 100}%`;
  el.questionText.textContent = q.question;

  el.optionBtns.forEach(btn => {
    btn.querySelector(".opt-text").textContent = q.options[btn.dataset.key] || "";
    btn.className = "option-btn";
    btn.disabled  = false;
  });

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

// ── Timeout ──────────────────────────────────────
async function handleTimeout() {
  if (state.answered) return;
  state.answered = true;
  disableOptions();

  try {
    const q       = state.questions[state.currentIndex];
    const isFinal = state.currentIndex === state.questions.length - 1;
    const data    = await jsonp({
      action: "submitAnswer",
      sessionId:      state.sessionId,
      questionId:     q.id,
      selectedOption: "",          // empty = timed out
      isFinal:        String(isFinal),
    });
    state.history.push({ questionId: q.id, correct: false, correctAnswer: data.correctAnswer });
    showFeedback("timeout", `Time's up! Answer: ${data.correctAnswer}`);
  } catch {
    showFeedback("timeout", "Time's up!");
  }
  scheduleNext();
}

// ── Answer click ──────────────────────────────────
el.optionBtns.forEach(btn => {
  btn.addEventListener("click", () => handleAnswer(btn.dataset.key));
});

async function handleAnswer(selected) {
  if (state.answered) return;
  state.answered = true;
  stopTimer();
  disableOptions();

  const selectedBtn = [...el.optionBtns].find(b => b.dataset.key === selected);
  selectedBtn?.classList.add("selected");

  const q       = state.questions[state.currentIndex];
  const isFinal = state.currentIndex === state.questions.length - 1;

  try {
    const data = await jsonp({
      action:         "submitAnswer",
      sessionId:      state.sessionId,
      questionId:     q.id,
      selectedOption: selected,
      isFinal:        String(isFinal),
    });

    state.score = data.score ?? state.score;
    el.liveScore.textContent = state.score;

    // Reveal correct / incorrect on buttons
    el.optionBtns.forEach(btn => {
      if (btn.dataset.key === data.correctAnswer) btn.classList.add("correct");
    });
    if (!data.correct) selectedBtn?.classList.add("incorrect");

    state.history.push({
      questionId:    q.id,
      correct:       data.correct,
      correctAnswer: data.correctAnswer,
      selected,
    });

    showFeedback(
      data.correct ? "correct" : "incorrect",
      data.correct ? "Correct! 🎉" : `Incorrect. Answer: ${data.correctAnswer}`
    );
  } catch (err) {
    showFeedback("timeout", "Server error — " + err.message);
  }

  scheduleNext();
}

// ── Helpers ──────────────────────────────────────
function disableOptions() {
  el.optionBtns.forEach(btn => { btn.disabled = true; });
}

function showFeedback(type, message) {
  el.feedbackBar.className = "feedback-bar " + (
    type === "correct"   ? "correct-fb"  :
    type === "incorrect" ? "incorrect-fb" : "timeout-fb"
  );
  el.feedbackIcon.textContent = type === "correct" ? "✓" : type === "incorrect" ? "✕" : "⏱";
  el.feedbackText.textContent = message;
}

function hideFeedback() {
  el.feedbackBar.className = "feedback-bar hidden";
}

function scheduleNext(delay = 2200) {
  setTimeout(() => {
    state.currentIndex++;
    el.progressBar.style.width = `${(state.currentIndex / state.questions.length) * 100}%`;
    if (state.currentIndex >= state.questions.length) showResults();
    else loadQuestion();
  }, delay);
}

// ── Results ───────────────────────────────────────
function showResults() {
  stopTimer();
  const total = state.questions.length;
  const score = state.score;
  el.finalScore.textContent = score;

  const { emoji, title } = gradeResult(score / total);
  el.resultsEmoji.textContent = emoji;
  el.resultsTitle.textContent = title;
  el.resultsMsg.textContent   = `${score} correct out of ${total} questions`;

  el.breakdown.innerHTML = "";
  state.history.forEach((h, i) => {
    const q   = state.questions[i];
    const row = document.createElement("div");
    row.className = "bd-row";
    row.innerHTML = `
      <span class="bd-dot ${h.correct ? "ok" : "bad"}"></span>
      <span class="bd-label">${(q?.question || "Q"+(i+1)).slice(0,42)}…</span>
      <span class="bd-tag">${h.correct ? "✓" : "✕ " + (h.correctAnswer || "")}</span>
    `;
    el.breakdown.appendChild(row);
  });

  showScreen("results");
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
