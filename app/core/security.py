import json
from cryptography.fernet import Fernet, InvalidToken
from app.core.config import CHAT_ENCRYPTION_KEY

fernet = Fernet(CHAT_ENCRYPTION_KEY.encode())


def encrypt_message(message):
    message_json = json.dumps(message)
    encrypted = fernet.encrypt(message_json.encode())
    return encrypted.decode()


def decrypt_message(encrypted_message):
    decrypted = fernet.decrypt(encrypted_message.encode())
    return json.loads(decrypted.decode())