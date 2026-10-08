# My Planner

Tell the assistant what's happening in normal sentences. It changes your Schedule, To-Do list, Daily Planner and Assessments for you.
The assistant runs on Google's Gemini API, using the free tier (model `gemini-3.5-flash-lite` by default).

## 1. Get a free Gemini API key

1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. Accept the terms if asked.
3. Click **Create API key**. If it asks for a project, choose the default one (or "Create project").
4. Copy the key (a long code starting with `AIza`). Keep it private.

You do not need to add a card or turn on billing. Free tier notes:
- The free tier limits how many **requests per minute and per day** you can make. You can see your exact limits at
  https://aistudio.google.com/rate-limit. Each chat message normally uses 1 request (planning a day uses about 2).
- If you hit a limit, the assistant tells you how long to wait. It does not keep retrying (retrying would use up more quota).
- `GEMINI_MODEL` picks the model. The default, `gemini-3.5-flash-lite`, has the most generous free limits. If plans feel
  too simple, try `gemini-3.8-flash` (smarter, but fewer free requests). `GEMINI_THINKING_LEVEL` (minimal/low/medium/high,
  default low) trades quality for quota in the same way.
- The terminal shows a line like `[gemini] gemini-3.5-flash-lite: 2 request(s), 6100 input + 300 output + 150 thinking tokens`
  after each message, so you can see exactly what each message used.
- On the free tier Google may use what you send to improve its products, so don't type anything private you wouldn't want reviewed.
- Gemini's free tier isn't offered in every country. If you see a region error, check https://ai.google.dev/gemini-api/docs/available-regions

## 2. Run it on your computer

1. Install **Node.js LTS** from https://nodejs.org (default options).
2. Open a terminal in this folder:
   - Mac: right-click the folder → Services → New Terminal at Folder
   - Windows: open the folder, click the address bar, type `cmd`, press Enter
3. Install: `npm install`
4. Create your settings file:
   - Mac: `cp .env.example .env`
   - Windows: `copy .env.example .env`
5. Open `.env` in a text editor (Notepad or TextEdit) and paste your key between the quotes:
   `GEMINI_API_KEY="AIza..."`
   Save the file.
6. Start: `npm run dev`
7. Open http://localhost:3000

Stop the site with Ctrl+C. Next time, just run `npm run dev` again.
Your data is saved in `data/planner.db` (created automatically).

If you ever see "model wasn't found", Google may have renamed its free model. Open
https://ai.google.dev/gemini-api/docs/pricing, pick a model whose Free Tier says "Free of charge"
(a "Flash" model), and put its name in `.env` as `GEMINI_MODEL="..."`. Then restart.

## 3. Put it online (Railway)

SQLite needs a disk that persists, so use Railway rather than Vercel.

1. Put this folder on GitHub (don't upload `.env`; `.gitignore` already excludes it).
2. On https://railway.app: New Project → Deploy from GitHub repo.
3. Add a Volume mounted at `/data`.
4. Variables: `GEMINI_API_KEY`, `DATABASE_PATH=/data/planner.db`, `PLANNER_PASSWORD=<your password>`.
5. Settings → Networking → Generate Domain.

Always set `PLANNER_PASSWORD` online so nobody else can use your key.

## Assessments

The Assessments page tracks upcoming tests: subject, date, topics, how much study each needs and how much you've done.
The assistant uses them when planning ("Plan my Wednesday", "Plan my week around my assessments"), spreading study over
the days before each test. Study blocks in the Daily Planner have a tick circle: ticking one adds its time to that
assessment (once; unticking takes it back). You can also just say "I studied physics for 45 minutes".

Upgrading from an older version needs no commands: the first time the new version starts, it adds the new table and
columns to your existing database without touching your data.

## How it fits together

- `lib/tools.ts`: every change to the planner (used by both the AI and the buttons), with input validation.
- `lib/ai.ts`: the instructions for Gemini and the function-calling loop.
- `lib/db.ts`: the SQLite database (tables are created automatically).
- `app/schedule`, `app/todo`, `app/planner`, `app/assessments`: the four pages.
- `components/MonthCalendar.tsx`: reusable month grid (used by Assessments).
- `components/ChatPanel.tsx`: the assistant panel.
