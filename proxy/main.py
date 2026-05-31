from fastapi import FastAPI

from app.main import app

assert isinstance(app, FastAPI)
