import hashlib

from app.core.config import (
    MAX_HISTORY_MESSAGES,
    CHAT_TTL_SECONDS
)
from app.core.security import encrypt_message, decrypt_message
from app.database.redis_client import redis_client


def chat_key(url):
    page = url.split("#")[0]
    conversation_id = hashlib.sha256(page.encode()).hexdigest()[:16]
    return f"helium:chat:{conversation_id}"


def format_history(messages):
    if not messages:
        return "(none)"

    lines = []

    for message in messages:
        who = "User" if message["role"] == "user" else "Assistant"
        lines.append(f"{who}: {message['content']}")

    return "\n".join(lines)


def get_chat_history(url):
    saved = redis_client.lrange(
        chat_key(url),
        -MAX_HISTORY_MESSAGES,
        -1
    )

    return [
        decrypt_message(message)
        for message in saved
    ]


def save_chat_history(url, question, answer):
    user_message = encrypt_message({
        "role": "user",
        "content": question
    })

    assistant_message = encrypt_message({
        "role": "assistant",
        "content": answer
    })

    key = chat_key(url)

    redis_client.rpush(
        key,
        user_message,
        assistant_message
    )

    redis_client.expire(key, CHAT_TTL_SECONDS)


def delete_chat_history(url):
    redis_client.delete(chat_key(url))