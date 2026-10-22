"""The app can ask whether AI answers before it shows any AI entry point.

With no provider key the assistant button, the AI quick estimate and the cost
advisor used to stay on screen and fail only when used. ``ai_availability``
runs the same provider choice as a real call, without making one, so the UI
can hide those entry points and tell an administrator where to add a key.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.crypto import encrypt_secret
from app.modules.ai import ai_client
from app.modules.ai.ai_client import ai_availability


@pytest.fixture(autouse=True)
def _no_ambient_keys(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    """Hide every environment key and the CLI config file from the lookup."""
    for _provider, names in ai_client._ENV_KEY_NAMES:
        for name in names:
            monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))


def _settings(**fields: object) -> SimpleNamespace:
    base = {"preferred_model": "claude-sonnet", "metadata_": None}
    base.update(fields)
    return SimpleNamespace(**base)


def test_no_settings_and_no_environment_key_is_not_configured() -> None:
    assert ai_availability(None) == (False, None, "no_key")
    assert ai_availability(_settings()) == (False, None, "no_key")


def test_a_saved_key_makes_ai_available() -> None:
    settings = _settings(openai_api_key=encrypt_secret("sk-test-openai"))
    assert ai_availability(settings) == (True, "openai", None)


def test_an_environment_key_makes_ai_available(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-env")
    assert ai_availability(None) == (True, "anthropic", None)


def test_an_unreadable_saved_key_is_reported_as_such() -> None:
    settings = _settings(anthropic_api_key="gAAAAAB-a-token-sealed-with-a-rotated-key")
    configured, provider, reason = ai_availability(settings)
    assert configured is False
    assert provider is None
    assert reason == "key_undecryptable"
