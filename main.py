import os
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from supabase import create_client, Client

from auth import verify_password, hash_password, create_access_token, get_current_user
from ai_parser import transcribe_audio, parse_voice_command
from reports import generate_expense_report, generate_party_report

# ─── Supabase client ───
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI(title="Business Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure reports directory exists
REPORTS_DIR = Path("generated_reports")
REPORTS_DIR.mkdir(exist_ok=True)


# ─── Pydantic Models ───
class LoginRequest(BaseModel):
    username: str
    password: str

class ExpenseCreate(BaseModel):
    category_id: str
    amount: float
    description: Optional[str] = ""
    raw_voice_text: Optional[str] = ""
    date: str  # YYYY-MM-DD

class LedgerCreate(BaseModel):
    party_id: str
    entry_type: str
    item_name: Optional[str] = ""
    quantity: Optional[float] = None
    unit: Optional[str] = ""
    rate: Optional[float] = None
    amount: float
    description: Optional[str] = ""
    raw_voice_text: Optional[str] = ""
    date: str

class CategoryCreate(BaseModel):
    name: str

class PartyCreate(BaseModel):
    name: str
    phone: Optional[str] = ""
    notes: Optional[str] = ""

class ExpenseUpdate(BaseModel):
    category_id: Optional[str] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    date: Optional[str] = None

class LedgerUpdate(BaseModel):
    party_id: Optional[str] = None
    entry_type: Optional[str] = None
    item_name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    rate: Optional[float] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    date: Optional[str] = None


# ─── Auth ───
@app.post("/api/login")
async def login(req: LoginRequest):
    result = supabase.table("users").select("*").eq("username", req.username).execute()
    if not result.data:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user = result.data[0]
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token({"user_id": user["id"], "username": user["username"]})
    return {"token": token, "user_id": user["id"], "display_name": user.get("display_name", user["username"])}


# ─── Voice Processing ───
@app.post("/api/voice/process")
async def process_voice(audio: UploadFile = File(...), user=Depends(get_current_user)):
    audio_bytes = await audio.read()
    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio too short")

    # Get user's categories and parties for context
    uid = user["user_id"]
    cats = supabase.table("expense_categories").select("name").eq("user_id", uid).eq("is_active", True).execute()
    parties = supabase.table("parties").select("name").eq("user_id", uid).eq("is_active", True).execute()

    category_names = [c["name"] for c in cats.data]
    party_names = [p["name"] for p in parties.data]

    # Transcribe
    text = await transcribe_audio(audio_bytes, audio.filename or "audio.webm")

    # Parse
    parsed = await parse_voice_command(text, category_names, party_names)
    parsed["transcribed_text"] = text

    return parsed


# ─── Categories ───
@app.get("/api/categories")
async def get_categories(user=Depends(get_current_user)):
    result = supabase.table("expense_categories") \
        .select("*").eq("user_id", user["user_id"]).eq("is_active", True) \
        .order("name").execute()
    return result.data

@app.post("/api/categories")
async def create_category(cat: CategoryCreate, user=Depends(get_current_user)):
    data = {
        "user_id": user["user_id"],
        "name": cat.name.strip(),
        "name_lower": cat.name.strip().lower()
    }
    result = supabase.table("expense_categories").insert(data).execute()
    return result.data[0]

@app.delete("/api/categories/{cat_id}")
async def delete_category(cat_id: str, user=Depends(get_current_user)):
    supabase.table("expense_categories") \
        .update({"is_active": False}).eq("id", cat_id).eq("user_id", user["user_id"]).execute()
    return {"ok": True}


# ─── Parties ───
@app.get("/api/parties")
async def get_parties(user=Depends(get_current_user)):
    result = supabase.table("parties") \
        .select("*").eq("user_id", user["user_id"]).eq("is_active", True) \
        .order("name").execute()
    return result.data

@app.post("/api/parties")
async def create_party(party: PartyCreate, user=Depends(get_current_user)):
    data = {
        "user_id": user["user_id"],
        "name": party.name.strip(),
        "name_lower": party.name.strip().lower(),
        "phone": party.phone,
        "notes": party.notes
    }
    result = supabase.table("parties").insert(data).execute()
    return result.data[0]

@app.delete("/api/parties/{party_id}")
async def delete_party(party_id: str, user=Depends(get_current_user)):
    supabase.table("parties") \
        .update({"is_active": False}).eq("id", party_id).eq("user_id", user["user_id"]).execute()
    return {"ok": True}


# ─── Expenses ───
@app.get("/api/expenses")
async def get_expenses(
    date_from: str = Query(None), date_to: str = Query(None),
    category_id: str = Query(None),
    user=Depends(get_current_user)
):
    q = supabase.table("expenses").select(
        "*, expense_categories(name)"
    ).eq("user_id", user["user_id"])

    if date_from:
        q = q.gte("date", date_from)
    if date_to:
        q = q.lte("date", date_to)
    if category_id:
        q = q.eq("category_id", category_id)

    result = q.order("date", desc=True).execute()

    # Flatten category name
    for r in result.data:
        cat = r.pop("expense_categories", None)
        r["category_name"] = cat["name"] if cat else ""

    return result.data

@app.post("/api/expenses")
async def create_expense(exp: ExpenseCreate, user=Depends(get_current_user)):
    data = {
        "user_id": user["user_id"],
        "category_id": exp.category_id,
        "amount": exp.amount,
        "description": exp.description,
        "raw_voice_text": exp.raw_voice_text,
        "date": exp.date
    }
    result = supabase.table("expenses").insert(data).execute()
    return result.data[0]

@app.put("/api/expenses/{exp_id}")
async def update_expense(exp_id: str, exp: ExpenseUpdate, user=Depends(get_current_user)):
    data = {k: v for k, v in exp.model_dump().items() if v is not None}
    result = supabase.table("expenses") \
        .update(data).eq("id", exp_id).eq("user_id", user["user_id"]).execute()
    return result.data[0] if result.data else {"ok": True}

@app.delete("/api/expenses/{exp_id}")
async def delete_expense(exp_id: str, user=Depends(get_current_user)):
    supabase.table("expenses") \
        .delete().eq("id", exp_id).eq("user_id", user["user_id"]).execute()
    return {"ok": True}


# ─── Ledger ───
@app.get("/api/ledger")
async def get_ledger(
    party_id: str = Query(None), date_from: str = Query(None), date_to: str = Query(None),
    user=Depends(get_current_user)
):
    q = supabase.table("ledger_entries").select(
        "*, parties(name)"
    ).eq("user_id", user["user_id"])

    if party_id:
        q = q.eq("party_id", party_id)
    if date_from:
        q = q.gte("date", date_from)
    if date_to:
        q = q.lte("date", date_to)

    result = q.order("date", desc=True).execute()

    for r in result.data:
        p = r.pop("parties", None)
        r["party_name"] = p["name"] if p else ""

    return result.data

@app.post("/api/ledger")
async def create_ledger(entry: LedgerCreate, user=Depends(get_current_user)):
    data = {
        "user_id": user["user_id"],
        "party_id": entry.party_id,
        "entry_type": entry.entry_type,
        "item_name": entry.item_name,
        "quantity": entry.quantity,
        "unit": entry.unit,
        "rate": entry.rate,
        "amount": entry.amount,
        "description": entry.description,
        "raw_voice_text": entry.raw_voice_text,
        "date": entry.date
    }
    result = supabase.table("ledger_entries").insert(data).execute()
    return result.data[0]

@app.put("/api/ledger/{entry_id}")
async def update_ledger(entry_id: str, entry: LedgerUpdate, user=Depends(get_current_user)):
    data = {k: v for k, v in entry.model_dump().items() if v is not None}
    result = supabase.table("ledger_entries") \
        .update(data).eq("id", entry_id).eq("user_id", user["user_id"]).execute()
    return result.data[0] if result.data else {"ok": True}

@app.delete("/api/ledger/{entry_id}")
async def delete_ledger(entry_id: str, user=Depends(get_current_user)):
    supabase.table("ledger_entries") \
        .delete().eq("id", entry_id).eq("user_id", user["user_id"]).execute()
    return {"ok": True}


# ─── Reports ───
@app.get("/api/reports/expenses")
async def expense_report(
    date_from: str = Query(...), date_to: str = Query(...),
    user=Depends(get_current_user)
):
    expenses = supabase.table("expenses").select(
        "*, expense_categories(name)"
    ).eq("user_id", user["user_id"]) \
     .gte("date", date_from).lte("date", date_to) \
     .order("date").execute()

    for r in expenses.data:
        cat = r.pop("expense_categories", None)
        r["category_name"] = cat["name"] if cat else ""

    d_from = date.fromisoformat(date_from)
    d_to = date.fromisoformat(date_to)

    user_info = supabase.table("users").select("display_name").eq("id", user["user_id"]).execute()
    name = user_info.data[0].get("display_name", "") if user_info.data else ""

    excel_bytes = generate_expense_report(expenses.data, d_from, d_to, name)

    filename = f"expenses_{date_from}_to_{date_to}.xlsx"
    filepath = REPORTS_DIR / filename
    filepath.write_bytes(excel_bytes)

    return {"download_url": f"/reports/{filename}", "filename": filename}


@app.get("/api/reports/party/{party_id}")
async def party_report(
    party_id: str, date_from: str = Query(...), date_to: str = Query(...),
    user=Depends(get_current_user)
):
    entries = supabase.table("ledger_entries").select("*") \
        .eq("user_id", user["user_id"]).eq("party_id", party_id) \
        .gte("date", date_from).lte("date", date_to) \
        .order("date").execute()

    party = supabase.table("parties").select("name").eq("id", party_id).execute()
    party_name = party.data[0]["name"] if party.data else "Unknown"

    d_from = date.fromisoformat(date_from)
    d_to = date.fromisoformat(date_to)

    excel_bytes = generate_party_report(party_name, entries.data, d_from, d_to)

    safe_name = party_name.replace(" ", "_")
    filename = f"ledger_{safe_name}_{date_from}_to_{date_to}.xlsx"
    filepath = REPORTS_DIR / filename
    filepath.write_bytes(excel_bytes)

    return {"download_url": f"/reports/{filename}", "filename": filename}


# ─── Serve report files ───
@app.get("/reports/{filename}")
async def download_report(filename: str):
    filepath = REPORTS_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Report not found")
    return FileResponse(
        filepath,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename
    )


# ─── Dashboard stats ───
@app.get("/api/dashboard")
async def dashboard(user=Depends(get_current_user)):
    uid = user["user_id"]
    today = datetime.utcnow() + timedelta(hours=5, minutes=30)
    today_str = today.strftime("%Y-%m-%d")
    month_start = today.replace(day=1).strftime("%Y-%m-%d")

    # FY start: April 1
    if today.month >= 4:
        fy_start = today.replace(month=4, day=1).strftime("%Y-%m-%d")
    else:
        fy_start = today.replace(year=today.year - 1, month=4, day=1).strftime("%Y-%m-%d")

    # Today's expenses
    today_exp = supabase.table("expenses").select("amount") \
        .eq("user_id", uid).eq("date", today_str).execute()
    today_total = sum(float(e["amount"]) for e in today_exp.data)

    # Month expenses
    month_exp = supabase.table("expenses").select("amount") \
        .eq("user_id", uid).gte("date", month_start).lte("date", today_str).execute()
    month_total = sum(float(e["amount"]) for e in month_exp.data)

    # FY expenses
    fy_exp = supabase.table("expenses").select("amount") \
        .eq("user_id", uid).gte("date", fy_start).lte("date", today_str).execute()
    fy_total = sum(float(e["amount"]) for e in fy_exp.data)

    # Recent entries (last 5)
    recent = supabase.table("expenses").select("*, expense_categories(name)") \
        .eq("user_id", uid).order("created_at", desc=True).limit(5).execute()
    for r in recent.data:
        cat = r.pop("expense_categories", None)
        r["category_name"] = cat["name"] if cat else ""

    # Party count
    party_count = supabase.table("parties").select("id", count="exact") \
        .eq("user_id", uid).eq("is_active", True).execute()

    return {
        "today_total": today_total,
        "month_total": month_total,
        "fy_total": fy_total,
        "recent_expenses": recent.data,
        "party_count": party_count.count or 0,
        "today_date": today_str
    }


# ─── Serve PWA static files ───
# Mount static files LAST so API routes take priority
static_path = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_path), name="static")


@app.get("/")
async def serve_index():
    return FileResponse(static_path / "index.html")

# Catch-all for PWA routing (serve index.html for any non-API path)
@app.get("/{path:path}")
async def catch_all(path: str):
    # Don't catch API or report routes
    if path.startswith("api/") or path.startswith("reports/"):
        raise HTTPException(status_code=404)
    file_path = static_path / path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)
    return FileResponse(static_path / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)
