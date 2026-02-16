# 📒 Business Tracker

Voice-powered expense tracking & client ledger app for small businesses. Supports Hindi/Hinglish voice commands.

**Stack:** FastAPI + Supabase + OpenAI + PWA (single Render deployment)

---

## 🚀 Setup Guide

### 1. Supabase Setup

1. Go to [supabase.com](https://supabase.com) → Create a new project
2. Note your **Project URL** and **Service Role Key** (Settings → API)
3. Go to **SQL Editor** → New Query → Paste the entire contents of `supabase_schema.sql` → Run
4. This creates all tables, indexes, RLS policies, and seeds a default admin user

**Default login:** `admin` / `admin123`

> To change the password, run this in SQL Editor:
> ```sql
> UPDATE users SET password_hash = crypt('your-new-password', gen_salt('bf'))
> WHERE username = 'admin';
> ```
> Or just use the app — new users can be added via SQL.

### 2. OpenAI Setup

1. Go to [platform.openai.com](https://platform.openai.com)
2. Create a new API key
3. Add some credits ($5-10 is plenty to start)
4. Models used: `whisper-1` (STT) + `gpt-4o-mini` (parsing) — very cheap

### 3. Local Development

```bash
# Clone/download the project
cd business-tracker

# Create .env file
cp .env.example .env
# Edit .env with your actual values:
# SUPABASE_URL=https://xxxxx.supabase.co
# SUPABASE_SERVICE_KEY=eyJhbG...
# OPENAI_API_KEY=sk-...
# SECRET_KEY=any-random-string-here

# Install dependencies
pip install -r requirements.txt

# Run
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Open `http://localhost:8000` in your browser.

### 4. Deploy to Render (Free Tier)

1. Push this project to a **GitHub repo**
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Runtime:** Python
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Plan:** Free
5. Add **Environment Variables** (same as .env):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `OPENAI_API_KEY`
   - `SECRET_KEY`
6. Deploy!

Your app will be live at `https://your-app-name.onrender.com`

### 5. Install as Mobile App (PWA)

**Android:**
1. Open the Render URL in Chrome
2. Tap the 3-dot menu → "Add to Home Screen"
3. It installs like a native app!

**iOS:**
1. Open the Render URL in Safari
2. Tap Share → "Add to Home Screen"

---

## 📱 How to Use

### Voice Commands (Hindi/Hinglish)
Press the 🎙 mic button and speak:

**Expenses:**
- "Petrol 500 rupees"
- "Train ticket 1278 rupay"
- "Chai nashta 150 rupay"

**Client Transactions:**
- "Ajay ji ko 50 kg donga bheja 320 ke rate pe"
- "Sharma ji se 5000 rupay mile"
- "Gupta ji ko 2000 rupay diye"

**Corrections:**
- "Pichla entry cancel karo"
- "Petrol wala 500 nahi 600 tha"

### Reports
1. Go to Reports tab
2. Select date range (or use quick presets)
3. Generate → Download Excel → Share on WhatsApp

---

## 📁 Project Structure

```
business-tracker/
├── main.py              # FastAPI app (API + serves PWA)
├── auth.py              # JWT authentication
├── ai_parser.py         # OpenAI Whisper + GPT-4o-mini
├── reports.py           # Excel report generation
├── requirements.txt     # Python dependencies
├── render.yaml          # Render deployment config
├── supabase_schema.sql  # Database schema (run in Supabase)
├── .env.example         # Environment variables template
└── static/              # PWA frontend
    ├── index.html       # HTML shell
    ├── app.js           # SPA logic
    ├── styles.css       # Styling
    ├── i18n.js          # Hindi/English translations
    ├── manifest.json    # PWA manifest
    └── sw.js            # Service worker
```

---

## 🛠 Adding More Users

Run in Supabase SQL Editor:
```sql
INSERT INTO users (username, password_hash, display_name)
VALUES ('username', crypt('password', gen_salt('bf')), 'Display Name');
```

## 💡 Notes

- All times are IST (GMT+5:30)
- Financial year: April 1 to March 31
- Free Render tier sleeps after 15 min inactivity (first load takes ~30s)
- Voice recording requires HTTPS (Render provides this)
- Data is stored in Supabase (persists even if Render restarts)
