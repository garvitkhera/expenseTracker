import json
import os
import tempfile
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

WHISPER_MODEL = "whisper-1"
PARSER_MODEL = "gpt-4o-mini"


async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Transcribe audio using OpenAI Whisper."""
    suffix = "." + filename.split(".")[-1] if "." in filename else ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(audio_bytes)
        tmp.flush()
        tmp.seek(0)
        with open(tmp.name, "rb") as audio_file:
            transcript = client.audio.transcriptions.create(
                model=WHISPER_MODEL,
                file=audio_file,
                language="hi",
                prompt="यह एक बिज़नेस खर्चे और लेनदेन की रिकॉर्डिंग है। Hindi aur Hinglish mein ho sakta hai. Numbers, rupees, kg, rates sunne ko milenge."
            )
    return transcript.text


async def parse_voice_command(text: str, categories: list[str], parties: list[str]) -> dict:
    """Parse transcribed text into structured data using GPT-4o-mini."""
    system_prompt = f"""You are a business transaction parser for an Indian small business owner.
Parse the Hindi/Hinglish/English voice input into a structured JSON response.

Available expense categories: {json.dumps(categories)}
Known party/client names: {json.dumps(parties)}

RULES:
1. Determine if this is an EXPENSE or a LEDGER (party/client transaction).
2. For expenses: extract category, amount, description, date context.
3. For ledger entries: extract party name, item, quantity, unit, rate, amount, entry_type.
4. entry_type can be: goods_sold, payment_received, payment_made, goods_returned, goods_taken
5. If a party name is mentioned, try to match it to known parties (fuzzy match on Hindi names).
6. If amount is not explicitly stated but rate and quantity are, calculate: amount = quantity × rate.
7. "diya/diye/de diye" = payment_made or goods_sold (context matters)
8. "liya/liye/le liye" = payment_received or goods_taken
9. "bheja/bhej diya" = goods_sold
10. "aaya/aa gaya/mila" = goods_taken or payment_received
11. If someone says "cancel karo" or "delete karo" for last entry, set type as "delete_last"
12. If someone corrects an amount like "500 nahi 600 tha", set type as "correction"
13. Default date is TODAY unless specified otherwise (kal = yesterday, parso = day before).

RESPOND ONLY WITH VALID JSON, no markdown:
{{
  "type": "expense" | "ledger" | "delete_last" | "correction" | "add_category" | "unknown",
  "category": "matched category name or suggested new one",
  "category_match_found": true/false,
  "party_name": "matched or new party name",
  "party_match_found": true/false,
  "entry_type": "goods_sold|payment_received|payment_made|goods_returned|goods_taken",
  "item_name": "item description if applicable",
  "quantity": number or null,
  "unit": "kg/piece/litre/etc or null",
  "rate": number or null,
  "amount": number,
  "description": "brief description in the original language",
  "date_offset_days": 0 for today, -1 for yesterday, etc.,
  "correction_details": "what to correct if type is correction",
  "confidence": 0.0 to 1.0
}}"""

    response = client.chat.completions.create(
        model=PARSER_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text}
        ],
        temperature=0.1,
        response_format={"type": "json_object"}
    )

    result = json.loads(response.choices[0].message.content)
    result["raw_text"] = text
    return result
