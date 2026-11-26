import os
import json
import hashlib
import redis
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from google import genai
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from cryptography.fernet import Fernet, InvalidToken
from rag import answer_from_page

load_dotenv()

app = FastAPI(title="Edgon API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Encryption ----------
encryption_key = os.getenv("CHAT_ENCRYPTION_KEY")

if not encryption_key:
    raise ValueError("CHAT_ENCRYPTION_KEY is missing from .env")

fernet = Fernet(encryption_key.encode())


def encrypt_message(message):
    message_json = json.dumps(message)
    encrypted = fernet.encrypt(message_json.encode())
    return encrypted.decode()


def decrypt_message(encrypted_message):
    decrypted = fernet.decrypt(encrypted_message.encode())
    return json.loads(decrypted.decode())


# ---------- Redis chat storage ----------
redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST"),
    port=int(os.getenv("REDIS_PORT")),
    username=os.getenv("REDIS_USERNAME"),
    password=os.getenv("REDIS_PASSWORD"),
    ssl=os.getenv("REDIS_SSL", "false").lower() == "true",
    decode_responses=True
)

MAX_HISTORY_MESSAGES = 10
CHAT_TTL_SECONDS = 30 * 24 * 3600


def chat_key(url):
    page = url.split("#")[0]
    conversation_id = hashlib.sha256(page.encode()).hexdigest()[:16]
    return f"helium:chat:{conversation_id}"


def format_history(messages):
    if not messages:
        return "(none)"

    lines = []

    for m in messages:
        who = "User" if m["role"] == "user" else "Assistant"
        lines.append(f"{who}: {m['content']}")

    return "\n".join(lines)


class QuestionRequest(BaseModel):
    question: str
    url: str
    api_key: str
    page_content: str = ""


@app.get("/")
def home():
    return {"message": "Edgestra API is running!"}


# ---------- Error handling ----------
def handle_rag_error(error):

    # Redis is not running
    if isinstance(error, redis.ConnectionError):
        raise HTTPException(
            status_code=503,
            detail="Chat storage (Redis) is not running. Please start Redis and try again."
        )

    error_msg = str(error).upper()

    # Invalid API key
    if "API_KEY_INVALID" in error_msg or "API KEY NOT VALID" in error_msg:
        raise HTTPException(
            status_code=401,
            detail="Your Gemini API key is invalid. Please go to the menu and change your API key."
        )

    # Quota or rate limit
    elif "RESOURCE_EXHAUSTED" in error_msg or "QUOTA" in error_msg or "429" in error_msg:
        raise HTTPException(
            status_code=429,
            detail="Gemini usage limit reached. Please try again later or change your API key from the menu."
        )

    # API access or permission issue
    elif "PERMISSION_DENIED" in error_msg or "403" in error_msg:
        raise HTTPException(
            status_code=403,
            detail="Your API key does not have permission to access this Gemini service. Check your API access or change your key."
        )

    # Gemini temporarily unavailable
    elif "UNAVAILABLE" in error_msg or "503" in error_msg or "OVERLOADED" in error_msg:
        raise HTTPException(
            status_code=503,
            detail="Gemini is temporarily overloaded. Please try again in a few minutes."
        )

    # Webpage fetching / SSL issue
    elif "CERTIFICATE_VERIFY_FAILED" in error_msg or "SSLERROR" in error_msg:
        raise HTTPException(
            status_code=502,
            detail="Helium couldn't securely fetch this webpage. Try another publicly accessible webpage."
        )

    # Other errors
    else:
        raise HTTPException(
            status_code=500,
            detail="Something went wrong while processing your question. Please try again."
        )


# ---------- Ask question ----------
@app.post("/ask")
def ask_question(data: QuestionRequest):

    try:
        key = chat_key(data.url)

        # Read and decrypt previous messages
        saved = redis_client.lrange(
            key,
            -MAX_HISTORY_MESSAGES,
            -1
        )

        messages = [
            decrypt_message(message)
            for message in saved
        ]

        history = format_history(messages)

        answer = answer_from_page(
            url=data.url,
            question=data.question,
            api_key=data.api_key,
            history=history,
            page_content=data.page_content
        )

        # Encrypt messages before saving in Redis
        user_message = encrypt_message({
            "role": "user",
            "content": data.question
        })

        assistant_message = encrypt_message({
            "role": "assistant",
            "content": answer
        })

        # Save only after a successful answer
        redis_client.rpush(
            key,
            user_message,
            assistant_message
        )

        redis_client.expire(key, CHAT_TTL_SECONDS)

        return {"answer": answer}

    except HTTPException:
        raise

    except InvalidToken:
        raise HTTPException(
            status_code=500,
            detail="Unable to decrypt chat history. Check your encryption key."
        )

    except Exception as e:
        print("RAG Error:", str(e))
        handle_rag_error(e)


# ---------- Get chat history ----------
@app.get("/history")
def get_history(url: str):

    try:
        saved = redis_client.lrange(chat_key(url), 0, -1)

        messages = [
            decrypt_message(message)
            for message in saved
        ]

        return {"messages": messages}

    except redis.ConnectionError:
        raise HTTPException(
            status_code=503,
            detail="Chat storage (Redis) is not running."
        )

    except InvalidToken:
        raise HTTPException(
            status_code=500,
            detail="Unable to decrypt chat history. Check your encryption key."
        )


# ---------- Delete chat history ----------
@app.delete("/history")
def delete_history(url: str):

    try:
        redis_client.delete(chat_key(url))
        return {"deleted": True}

    except redis.ConnectionError:
        raise HTTPException(
            status_code=503,
            detail="Chat storage (Redis) is not running."
        )


# ---------- Verify Gemini API key ----------
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
