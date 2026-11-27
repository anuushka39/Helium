import os
from dotenv import load_dotenv

load_dotenv()

# Redis configuration
REDIS_HOST = os.getenv("REDIS_HOST")
REDIS_PORT = int(os.getenv("REDIS_PORT"))
REDIS_USERNAME = os.getenv("REDIS_USERNAME")
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD")
REDIS_SSL = os.getenv("REDIS_SSL", "false").lower() == "true"

# Encryption
CHAT_ENCRYPTION_KEY = os.getenv("CHAT_ENCRYPTION_KEY")

if not CHAT_ENCRYPTION_KEY:
    raise ValueError("CHAT_ENCRYPTION_KEY is missing from .env")

# Chat configuration
MAX_HISTORY_MESSAGES = 10
CHAT_TTL_SECONDS = 30 * 24 * 3600

# Gemini
GEMINI_MODEL = "gemini-3.5-flash-lite"