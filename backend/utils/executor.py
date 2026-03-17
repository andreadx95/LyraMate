import subprocess
import tempfile
import os
import re
import io
import sys
import asyncio
from contextlib import redirect_stdout, redirect_stderr
from concurrent.futures import ThreadPoolExecutor

_executor_pool = ThreadPoolExecutor(max_workers=2)


def _run_code_in_process(code: str) -> tuple[str, str]:
    """
    Run AI code in-process via exec().
    Fast — no subprocess spawn. Shares the server process.
    """
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    try:
        namespace = {"__builtins__": __builtins__}
        with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
            exec(code, namespace)
    except Exception as e:
        stderr_capture.write(str(e))

    return stdout_capture.getvalue(), stderr_capture.getvalue()


def _run_code_subprocess(code: str) -> tuple[str, str]:
    """Run in isolated subprocess with timeout."""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".py", mode="w") as f:
        f.write(code)
        temp_path = f.name

    try:
        result = subprocess.run(
            [sys.executable, temp_path],
            capture_output=True,
            text=True,
            timeout=20
        )
        return result.stdout, result.stderr
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


def run_ai_code(code: str, use_subprocess: bool = False) -> tuple[str, str]:
    """
    Run AI-generated code with safety checks.
    Default: in-process (fast). use_subprocess=True for isolation.
    """
    if use_subprocess:
        return _run_code_subprocess(code)
    return _run_code_in_process(code)


async def run_ai_code_async(code: str, use_subprocess: bool = False) -> tuple[str, str]:
    """Async version — runs code in a thread without blocking the event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _executor_pool,
        run_ai_code,
        code,
        use_subprocess
    )


def extract_code(text: str):
    match = re.search(r"```(?:python)?\n(.*?)```", text, re.DOTALL)
    if match:
        return [match.group(1)]
    return text