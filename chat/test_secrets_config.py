"""Tests for secrets_config."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import secrets_config as sc


class SecretsConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._secrets_path = Path(self._tmpdir.name) / "secrets.json"
        self._config_dir = self._secrets_path.parent
        patcher = patch.object(sc, "SECRETS_PATH", self._secrets_path)
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher_dir = patch.object(sc, "CONFIG_DIR", self._config_dir)
        patcher_dir.start()
        self.addCleanup(patcher_dir.stop)

    def test_save_and_load_roundtrip(self) -> None:
        saved = sc.save_secrets_raw({"OPENAI_API_KEY": "sk-test-openai"})
        self.assertEqual(saved["OPENAI_API_KEY"], "sk-test-openai")
        loaded = sc.load_secrets_raw()
        self.assertEqual(loaded["OPENAI_API_KEY"], "sk-test-openai")

    def test_clear_secret_removes_key(self) -> None:
        sc.save_secrets_raw({"GEMINI_API_KEY": "gem-key"})
        sc.clear_secret("GEMINI_API_KEY")
        self.assertNotIn("GEMINI_API_KEY", sc.load_secrets_raw())

    def test_mask_value_never_returns_full_key(self) -> None:
        status = sc.secrets_status_response()
        sc.save_secrets_raw({"ANTHROPIC_API_KEY": "sk-ant-secret-value"})
        with patch.dict(os.environ, {}, clear=True):
            status = sc.secrets_status_response()
        self.assertTrue(status["ANTHROPIC_API_KEY"]["configured"])
        self.assertNotIn("secret-value", status["ANTHROPIC_API_KEY"]["hint"])
        self.assertTrue(status["ANTHROPIC_API_KEY"]["hint"].endswith("alue"))

    def test_env_precedence_over_file(self) -> None:
        sc.save_secrets_raw({"GROQ_API_KEY": "file-key"})
        with patch.dict(os.environ, {"GROQ_API_KEY": "env-key"}, clear=False):
            self.assertEqual(sc.get_effective_secret("GROQ_API_KEY"), "env-key")

    def test_apply_secrets_fills_missing_env(self) -> None:
        sc.save_secrets_raw({"ELEVENLABS_API_KEY": "el-key"})
        with patch.dict(os.environ, {}, clear=True):
            with patch.object(sc, "_STARTUP_ENV_KEYS", frozenset()):
                sc.apply_secrets_to_environ()
                self.assertEqual(os.environ.get("ELEVENLABS_API_KEY"), "el-key")

    def test_clear_secret_unsets_env_for_ui_saved_keys(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with patch.object(sc, "_STARTUP_ENV_KEYS", frozenset()):
                sc.save_secrets_raw({"OPENAI_API_KEY": "sk-ui-key"})
                sc.apply_secrets_to_environ()
                self.assertTrue(sc.secrets_status_response()["OPENAI_API_KEY"]["configured"])
                sc.clear_secret("OPENAI_API_KEY")
                sc.apply_secrets_to_environ()
                status = sc.secrets_status_response()["OPENAI_API_KEY"]
                self.assertFalse(status["configured"])
                self.assertEqual(os.environ.get("OPENAI_API_KEY"), None)

    def test_clear_secret_keeps_env_when_from_dotenv(self) -> None:
        sc.save_secrets_raw({"GEMINI_API_KEY": "file-key"})
        with patch.dict(os.environ, {"GEMINI_API_KEY": "env-key"}, clear=False):
            with patch.object(sc, "_STARTUP_ENV_KEYS", frozenset({"GEMINI_API_KEY"})):
                sc.clear_secret("GEMINI_API_KEY")
                sc.apply_secrets_to_environ()
                status = sc.secrets_status_response()["GEMINI_API_KEY"]
                self.assertTrue(status["configured"])
                self.assertEqual(status["source"], "env")
                self.assertEqual(os.environ.get("GEMINI_API_KEY"), "env-key")

    def test_unsupported_key_raises(self) -> None:
        with self.assertRaises(ValueError):
            sc.save_secrets_raw({"NOT_A_KEY": "x"})

    def test_secrets_file_payload_shape(self) -> None:
        sc.save_secrets_raw({"OPENAI_API_KEY": "sk-test"})
        payload = json.loads(self._secrets_path.read_text(encoding="utf-8"))
        self.assertIn("keys", payload)
        self.assertEqual(payload["keys"]["OPENAI_API_KEY"], "sk-test")


if __name__ == "__main__":
    unittest.main()
