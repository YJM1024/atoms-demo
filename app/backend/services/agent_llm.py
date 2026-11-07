"""DeepSeek provider for the agent team.

Every agent call (PM, architect, engineer, patches, tester-driven fixes) is sent
with the model alias ``AGENT_MODEL_ALIAS``; the AI hub routes that alias here.
The API key is read from the backend environment only and never reaches the browser.
"""
import logging
import os
from typing import AsyncGenerator

from schemas.aihub import GenTxtRequest

try:
    from core.telemetry import observe_external_http
except Exception:  # noqa: BLE001 - optional across template versions
    async def observe_external_http(operation):
        return await operation

logger = logging.getLogger(__name__)

AGENT_MODEL_ALIAS = "agent"

# Central provider configuration; override through environment variables.
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-flash")
# Used automatically when the primary model name is rejected as unknown/unavailable.
DEEPSEEK_FALLBACK_MODEL = os.environ.get("DEEPSEEK_FALLBACK_MODEL", "deepseek-chat")
# DeepSeek chat models allow at most 8192 output tokens; longer files are continued by the client.
DEEPSEEK_MAX_TOKENS = int(os.environ.get("DEEPSEEK_MAX_TOKENS", "8192"))
DEEPSEEK_TEMPERATURE = float(os.environ.get("DEEPSEEK_TEMPERATURE", "0.4"))
DEEPSEEK_TIMEOUT = float(os.environ.get("DEEPSEEK_TIMEOUT", "300"))

# Emitted once before falling back so the conversation stream explains the switch.
FALLBACK_NOTICE = "[提示] 模型 {primary} 当前不可用，已自动切换到 {fallback} 继续生成。\n"


class AgentLLMError(RuntimeError):
    """Provider error carrying a user-facing Chinese message."""


def is_agent_model(model: str) -> bool:
    return model == AGENT_MODEL_ALIAS


def provider_info() -> dict:
    return {
        "provider": "DeepSeek",
        "model": DEEPSEEK_MODEL,
        "fallback_model": DEEPSEEK_FALLBACK_MODEL,
        "max_tokens": DEEPSEEK_MAX_TOKENS,
        "configured": bool(os.environ.get("DEEPSEEK_API_KEY")),
    }


def _is_unknown_model_error(exc: Exception) -> bool:
    """True when the provider rejected the request because the model name is unusable.

    Covers DeepSeek's 400/404 "Model Not Exist" replies and permission errors that
    name the model, so the caller can retry once with the fallback model.
    """
    status = getattr(exc, "status_code", None)
    if status not in (400, 403, 404):
        return False
    text = f"{getattr(exc, 'message', '')} {exc}".lower()
    if "model" not in text:
        return False
    markers = (
        "not exist",
        "not found",
        "does not exist",
        "unknown model",
        "invalid model",
        "model_not_found",
        "no access",
        "not allowed",
        "unsupported",
        "supported api model",
        "but you passed",
    )
    return any(marker in text for marker in markers)


def _client():
    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise AgentLLMError("未配置 DeepSeek API Key（DEEPSEEK_API_KEY），请在密钥设置中填写后重试。")
    from openai import AsyncOpenAI

    return AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL.rstrip("/"), timeout=DEEPSEEK_TIMEOUT, max_retries=1)


def _friendly_error(exc: Exception) -> AgentLLMError:
    """Maps provider failures to clear Chinese messages for the conversation stream."""
    import openai

    status = getattr(exc, "status_code", None)
    if isinstance(exc, openai.AuthenticationError) or status == 401:
        return AgentLLMError("DeepSeek API Key 无效或已被撤销，请检查密钥设置中的 DEEPSEEK_API_KEY。")
    if status == 402:
        return AgentLLMError("DeepSeek 账户余额不足，请在 DeepSeek 开放平台充值后重试。")
    if isinstance(exc, openai.RateLimitError) or status == 429:
        return AgentLLMError("DeepSeek 请求过于频繁（触发限流），请稍等片刻后重试。")
    if status == 400 or status == 422:
        return AgentLLMError(f"DeepSeek 拒绝了这次请求（参数或上下文过长）：{getattr(exc, 'message', exc)}")
    if status in (500, 502, 503):
        return AgentLLMError("DeepSeek 服务繁忙或暂时不可用，请稍后重试。")
    if isinstance(exc, openai.APITimeoutError):
        return AgentLLMError("DeepSeek 响应超时，请重试；需求较复杂时可以拆成几步来提。")
    if isinstance(exc, openai.APIConnectionError):
        return AgentLLMError("无法连接到 DeepSeek 服务，请检查网络后重试。")
    return AgentLLMError(f"DeepSeek 调用失败：{exc}")


def _messages(request: GenTxtRequest) -> list[dict]:
    result = []
    for msg in request.messages:
        content = msg.content
        if isinstance(content, list):  # DeepSeek chat is text-only
            content = "\n".join(getattr(part, "text", "") for part in content if getattr(part, "text", None))
        result.append({"role": msg.role, "content": content})
    return result


async def _create(client, request: GenTxtRequest, model: str, stream_mode: bool):
    return await observe_external_http(
        client.chat.completions.create(
            model=model,
            messages=_messages(request),
            temperature=DEEPSEEK_TEMPERATURE,
            max_tokens=DEEPSEEK_MAX_TOKENS,
            stream=stream_mode,
        )
    )


async def stream(request: GenTxtRequest) -> AsyncGenerator[str, None]:
    client = _client()
    model = DEEPSEEK_MODEL
    try:
        response = await _create(client, request, model, True)
    except AgentLLMError:
        raise
    except Exception as exc:  # noqa: BLE001 - mapped to a user-facing message
        if not (_is_unknown_model_error(exc) and DEEPSEEK_FALLBACK_MODEL and DEEPSEEK_FALLBACK_MODEL != model):
            logger.error("DeepSeek stream error: %s", exc)
            raise _friendly_error(exc) from exc
        logger.warning("DeepSeek model %s unavailable, falling back to %s: %s", model, DEEPSEEK_FALLBACK_MODEL, exc)
        yield FALLBACK_NOTICE.format(primary=model, fallback=DEEPSEEK_FALLBACK_MODEL)
        model = DEEPSEEK_FALLBACK_MODEL
        try:
            response = await _create(client, request, model, True)
        except Exception as retry_exc:  # noqa: BLE001
            logger.error("DeepSeek stream error on fallback model: %s", retry_exc)
            raise _friendly_error(retry_exc) from retry_exc

    try:
        finish_reason = None
        async for chunk in response:
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            if choice.delta and choice.delta.content:
                yield choice.delta.content
            if choice.finish_reason:
                finish_reason = choice.finish_reason
        if finish_reason == "length":
            logger.info("DeepSeek output hit max_tokens=%s; client will continue.", DEEPSEEK_MAX_TOKENS)
    except AgentLLMError:
        raise
    except Exception as exc:  # noqa: BLE001 - mapped to a user-facing message
        logger.error("DeepSeek stream error: %s", exc)
        raise _friendly_error(exc) from exc


async def complete(request: GenTxtRequest) -> str:
    client = _client()
    try:
        response = await _create(client, request, DEEPSEEK_MODEL, False)
    except AgentLLMError:
        raise
    except Exception as exc:  # noqa: BLE001
        if not (_is_unknown_model_error(exc) and DEEPSEEK_FALLBACK_MODEL and DEEPSEEK_FALLBACK_MODEL != DEEPSEEK_MODEL):
            logger.error("DeepSeek completion error: %s", exc)
            raise _friendly_error(exc) from exc
        logger.warning("DeepSeek model %s unavailable, falling back to %s", DEEPSEEK_MODEL, DEEPSEEK_FALLBACK_MODEL)
        try:
            response = await _create(client, request, DEEPSEEK_FALLBACK_MODEL, False)
        except Exception as retry_exc:  # noqa: BLE001
            logger.error("DeepSeek completion error on fallback model: %s", retry_exc)
            raise _friendly_error(retry_exc) from retry_exc
    return response.choices[0].message.content or ""
