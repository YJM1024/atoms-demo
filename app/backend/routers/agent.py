"""Exposes the agent team's provider configuration (no secrets)."""
from fastapi import APIRouter
from pydantic import BaseModel

from services.agent_llm import provider_info

router = APIRouter(prefix="/api/v1/agent", tags=["agent"])


class AgentConfigResponse(BaseModel):
    provider: str
    model: str
    fallback_model: str
    max_tokens: int
    configured: bool


@router.get("/config", response_model=AgentConfigResponse)
async def agent_config():
    return AgentConfigResponse(**provider_info())
