# QuizCore — Deployment Guide

## Project Structure
```
quiz-mvp/
├── Code.gs              ← Google Apps Script backend
├── questions_seed.csv   ← Paste into Google Sheets
├── index.html           ← Frontend entry point
├── style.css            ← Styles
└── script.js            ← Quiz logic (set API_BASE_URL here)
```

---

## Step 1 — Set Up Google Sheets

1. Go to https://sheets.google.com and create a **new spreadsheet**.
2. Rename it: `QuizCore DB`
3. Rename the first sheet tab to: `Questions`
4. Add these **column headers** in Row 1 (A → J):

| A  | B        | C        | D        | E        | F        | G              | H        | I          | J                    |
|----|----------|----------|----------|----------|----------|----------------|----------|------------|----------------------|
| id | question | option_a | option_b | option_c | option_d | correct_answer | category | difficulty | time_limit_seconds   |

5. Paste the data rows from `questions_seed.csv` (skip the header row, already added above).
6. Copy the **Spreadsheet URL** — you'll need it in Step 2.

---

## Step 2 — Set Up Google Apps Script

1. In your Google Sheet, click **Extensions → Apps Script**.
2. Delete all existing code in the editor.
3. Paste the entire contents of `Code.gs`.
4. At the top of the script, the active spreadsheet is used automatically — no URL needed.
5. Click **Save** (floppy disk icon).

---

## Step 3 — Deploy as Web App

1. Click **Deploy → New deployment**.
2. Click the gear ⚙️ next to "Select type" → choose **Web app**.
3. Fill in:
   - **Description**: QuizCore API v1
   - **Execute as**: Me
   - **Who has access**: Anyone ← important for the frontend to call it
4. Click **Deploy**.
5. Authorize the app when prompted (Google will ask for permissions).
6. **Copy the Web App URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

---

## Step 4 — Configure the Frontend

Open `script.js` and replace the placeholder on line 6:

```js
// BEFORE
const API_BASE_URL = "YOUR_APPS_SCRIPT_URL_HERE";

// AFTER
const API_BASE_URL = "https://script.google.com/macros/s/AKfycbXXXXXXXXX/exec";
```

---

## Step 5 — Run the Frontend

### Option A — Open Locally
Just open `index.html` in any modern browser. No server needed.

### Option B — Host on GitHub Pages
1. Push the three files (`index.html`, `style.css`, `script.js`) to a GitHub repo.
2. Go to Settings → Pages → Source: main branch → root.
3. Your quiz is live at `https://yourusername.github.io/repo-name`.

### Option C — Host on Netlify / Vercel
Drag and drop the folder into https://app.netlify.com/drop — done in 30 seconds.

---

## API Reference

### GET `?action=getQuestions`
Returns all questions without exposing correct answers.

**Response:**
```json
{
  "success": true,
  "questions": [
    {
      "id": "Q1",
      "question": "What does HTML stand for?",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "category": "Web Dev",
      "difficulty": "Easy",
      "timeLimit": 15
    }
  ]
}
```

### POST (body: `{ action: "initSession" }`)
Creates a new session row in the Sessions sheet.

**Response:**
```json
{ "success": true, "sessionId": "uuid-here" }
```

### POST (body: `{ action: "submitAnswer", ... }`)
Validates answer server-side.

**Request body:**
```json
{
  "action": "submitAnswer",
  "sessionId": "uuid-here",
  "questionId": "Q1",
  "selectedOption": "A",
  "isFinal": false
}
```

**Response:**
```json
{
  "success": true,
  "correct": true,
  "correctAnswer": "A",
  "score": 1,
  "questionId": "Q1"
}
```

---

## Updating Questions

1. Add/edit rows in the `Questions` sheet — changes apply instantly.
2. No re-deployment needed for content changes.
3. To change code, re-deploy: **Deploy → Manage deployments → Edit → Deploy**.

---

## Notes

- Correct answers are **never sent to the browser** until after validation.
- Sessions are tracked in a `Sessions` sheet (auto-created on first use).
- The timer is purely client-side; the server validates answers regardless of time.
- Apps Script has a 6 min execution limit per call — well within quiz usage.
