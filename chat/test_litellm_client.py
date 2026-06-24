import unittest

from litellm_client import (
    build_completion_payload,
    extract_search_sources_from_chunk,
    is_gemini_model,
)


class LiteLLMClientTests(unittest.TestCase):
    def test_is_gemini_model(self) -> None:
        self.assertTrue(is_gemini_model("gemini/gemini-2.0-flash"))
        self.assertFalse(is_gemini_model("openai/gpt-4o"))

    def test_gemini_google_search_adds_tool(self) -> None:
        payload = build_completion_payload(
            "gemini/gemini-2.0-flash",
            [{"role": "user", "content": "hi"}],
            stream=True,
            tools=[{"type": "function", "function": {"name": "foo", "parameters": {}}}],
            gemini_google_search=True,
        )
        self.assertIn("googleSearch", str(payload["tools"]))
        self.assertTrue(payload.get("include_server_side_tool_invocations"))

    def test_gemini_google_search_ignored_for_non_gemini(self) -> None:
        payload = build_completion_payload(
            "openai/gpt-4o",
            [{"role": "user", "content": "hi"}],
            stream=True,
            tools=[{"type": "function", "function": {"name": "foo", "parameters": {}}}],
            gemini_google_search=True,
        )
        self.assertNotIn("googleSearch", str(payload.get("tools", [])))
        self.assertNotIn("include_server_side_tool_invocations", payload)

    def test_extract_grounding_sources(self) -> None:
        chunk = {
            "vertex_ai_grounding_metadata": [
                {
                    "groundingChunks": [
                        {
                            "web": {
                                "uri": "https://example.com/a",
                                "title": "Example A",
                            }
                        },
                        {
                            "web": {
                                "uri": "https://example.com/b",
                                "title": "Example B",
                            }
                        },
                    ]
                }
            ]
        }
        sources = extract_search_sources_from_chunk(chunk)
        self.assertEqual(len(sources), 2)
        self.assertEqual(sources[0]["title"], "Example A")
        self.assertEqual(sources[0]["url"], "https://example.com/a")


if __name__ == "__main__":
    unittest.main()
