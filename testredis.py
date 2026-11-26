#run this file to check redic connection
import os
import redis
from dotenv import load_dotenv
load_dotenv()

r = redis.Redis(
    host=os.getenv("REDIS_HOST"),
    port=int(os.getenv("REDIS_PORT")),
    username=os.getenv("REDIS_USERNAME"),
    password=os.getenv("REDIS_PASSWORD"),
    ssl=os.getenv("REDIS_SSL", "false").lower() == "true",
    decode_responses=True
)

try:
    print("Connecting to Redis...")
    print("Connection:", r.ping())
    r.set("helium:test", "Redis is working!")
    result = r.get("helium:test")
    print("Stored value:", result)
    r.delete("helium:test")
    print("Redis test successful!")
except redis.exceptions.RedisError as e:
    print("Redis connection failed:", e)
