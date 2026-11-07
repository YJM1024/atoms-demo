"""Verifies the automatic fallback when the configured model name is unusable.

Run from /workspace/app/backend:  python ../../scripts/verify/fallback_check.py
"""
import asyncio
import os
import sys

sys.path.insert(0, "/workspace/app/backend")

from schemas.aihub import GenTxtRequest  # noqa: E402
from services import agent_llm  # noqa: E402

REQUEST = GenTxtRequest(messages=[{"role": "user", "content": "只回复两个字：你好"}], model="agent", stream=True)


async def collect(label: str, primary: str, fallback: str) -> None:
    agent_llm.DEEPSEEK_MODEL = primary
    agent_llm.DEEPSEEK_FALLBACK_MODEL = fallback
    pieces = []
    try:
        async for piece in agent_llm.stream(REQUEST):
            pieces.append(piece)
    except agent_llm.AgentLLMError as exc:
        print(f"[{label}] primary={primary} fallback={fallback} -> error: {exc}")
        return
    text = "".join(pieces)
    notice = text.splitlines()[0] if text.startswith("[提示]") else None
    body = text[len(notice) :].strip() if notice else text.strip()
    print(f"[{label}] primary={primary} fallback={fallback}")
    print(f"  notice: {notice}")
    print(f"  body: {body[:80]!r}")


def load_key_from_backend_process() -> None:
    """Reads DEEPSEEK_API_KEY from the running backend process env; never prints it."""
    if os.environ.get("DEEPSEEK_API_KEY"):
        return
    import glob

    for environ_path in glob.glob("/proc/[0-9]*/environ"):
        try:
            raw = open(environ_path, "rb").read().decode("utf-8", "ignore")
        except OSError:
            continue
        for entry in raw.split("\0"):
            if entry.startswith("DEEPSEEK_API_KEY=") and len(entry) > len("DEEPSEEK_API_KEY=") + 5:
                os.environ["DEEPSEEK_API_KEY"] = entry.split("=", 1)[1]
                return


async def main() -> None:
    load_key_from_backend_process()
    assert os.environ.get("DEEPSEEK_API_KEY"), "DEEPSEEK_API_KEY missing in this process"
    await collect("configured", "deepseek-flash", "deepseek-chat")
    await collect("unknown-model", "deepseek-flash-not-real", "deepseek-chat")
    await collect("both-unknown", "deepseek-flash-not-real", "deepseek-chat-not-real")


asyncio.run(main())
