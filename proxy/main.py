from fastapi import FastAPI

from app.main import app as proxy_app

app = FastAPI(title="QuantSage Groq Proxy Entrypoint")
app.mount("", proxy_app)
