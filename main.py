import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from google import genai
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

app = FastAPI(title="Edgon API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class QuestionRequest(BaseModel):
    question: str
    context: str = ""


def generate_answer(question, context):

    prompt = f"""
    You are Edgon, an AI web companion.

    Answer the user's question clearly and accurately.
    Use the webpage content when relevant.

    Webpage content:
    {context}

    User question:
    {question}
    """

    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents=prompt
    )

    return response.text


@app.get("/")
def home():
    return {"message": "Edgestra API is running!"}


@app.post("/ask")
def ask_question(data: QuestionRequest):
    try:
        answer = generate_answer(data.question, data.context)
        return {"answer": answer}

    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

class VerifyKeyRequest(BaseModel):
    api_key: str
@app.post("/verify-key")
def verify_key(data: VerifyKeyRequest):
    try:
        test_client = genai.Client(api_key=data.api_key)

        response = test_client.models.generate_content(
            model="gemini-3.5-flash-lite",
            contents="Reply with OK."
        )

        if not response.text:
            raise HTTPException(
                status_code=400,
                detail="API key verification failed."
            )

        return {"valid": True}

    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Invalid API key or Gemini access unavailable. Check your key and API access."
        )
