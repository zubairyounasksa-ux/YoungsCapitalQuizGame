// ============================================================
// QUIZ MVP — Google Apps Script Backend
// Deploy as: Web App → Execute as: Me → Who has access: Anyone
// ============================================================

const SHEET_NAME = "Questions";
const SCORE_SHEET_NAME = "Sessions";

// ── CORS helper ──────────────────────────────────────────────
function setCORSHeaders(output) {
  return output
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "Content-Type",
    });
}

function buildJSON(data) {
  return setCORSHeaders(
    ContentService.createTextOutput(JSON.stringify(data))
  );
}

// ── Router ────────────────────────────────────────────────────
function doGet(e) {
  const action = e.parameter.action || "";
  if (action === "getQuestions") return getQuestions();
  return buildJSON({ error: "Unknown action. Use ?action=getQuestions" });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || "";
    if (action === "submitAnswer") return submitAnswer(body);
    if (action === "initSession") return initSession(body);
    return buildJSON({ error: "Unknown action." });
  } catch (err) {
    return buildJSON({ error: "Invalid JSON body: " + err.message });
  }
}

// ── getQuestions ──────────────────────────────────────────────
// Returns all questions WITHOUT exposing correct answers.
function getQuestions() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return buildJSON({ error: `Sheet "${SHEET_NAME}" not found.` });

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0]; // row 1 = header
  const questions = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const id = row[0];
    if (!id) continue; // skip empty rows

    questions.push({
      id: String(id),
      question: row[1],
      options: {
        A: row[2],
        B: row[3],
        C: row[4],
        D: row[5],
      },
      category: row[7] || "General",
      difficulty: row[8] || "Medium",
      timeLimit: Number(row[9]) || 20, // seconds per question
    });
    // Note: row[6] = correct_answer — intentionally omitted
  }

  return buildJSON({ success: true, questions });
}

// ── initSession ───────────────────────────────────────────────
// Creates a fresh session row and returns sessionId.
function initSession(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SCORE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SCORE_SHEET_NAME);
    sheet.appendRow(["sessionId", "score", "answers", "startTime", "endTime"]);
  }

  const sessionId = Utilities.getUuid();
  sheet.appendRow([sessionId, 0, "[]", new Date().toISOString(), ""]);
  return buildJSON({ success: true, sessionId });
}

// ── submitAnswer ──────────────────────────────────────────────
// Validates answer server-side. Never exposes correct answer before checking.
function submitAnswer(body) {
  const { sessionId, questionId, selectedOption } = body;
  if (!sessionId || !questionId || !selectedOption) {
    return buildJSON({ error: "Missing sessionId, questionId, or selectedOption." });
  }

  // Look up correct answer
  const qSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const rows = qSheet.getDataRange().getValues();
  let correctAnswer = null;
  let questionText = "";

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(questionId)) {
      correctAnswer = String(rows[i][6]).trim().toUpperCase(); // column G
      questionText = rows[i][1];
      break;
    }
  }

  if (!correctAnswer) return buildJSON({ error: "Question not found." });

  const isCorrect = selectedOption.trim().toUpperCase() === correctAnswer;

  // Update session score
  const sSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCORE_SHEET_NAME);
  if (sSheet) {
    const sRows = sSheet.getDataRange().getValues();
    for (let r = 1; r < sRows.length; r++) {
      if (sRows[r][0] === sessionId) {
        const currentScore = Number(sRows[r][1]) || 0;
        const newScore = isCorrect ? currentScore + 1 : currentScore;
        const answers = JSON.parse(sRows[r][2] || "[]");
        answers.push({ questionId, selectedOption, isCorrect });

        sSheet.getRange(r + 1, 2).setValue(newScore);
        sSheet.getRange(r + 1, 3).setValue(JSON.stringify(answers));
        if (body.isFinal) sSheet.getRange(r + 1, 5).setValue(new Date().toISOString());

        return buildJSON({
          success: true,
          correct: isCorrect,
          correctAnswer,          // reveal AFTER validation
          score: newScore,
          questionId,
        });
      }
    }
  }

  // Session not tracked (still return result)
  return buildJSON({ success: true, correct: isCorrect, correctAnswer, questionId });
}
