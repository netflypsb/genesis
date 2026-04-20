# Ollama Cloud with Claude Code

## Why this path

- **No API key management.** You sign into the Ollama desktop app once.
- The app proxies `*:cloud` models (e.g. `kimi-k2.5:cloud`, `gpt-oss:120b-cloud`) through the local `:11434` daemon.
- Claude Code sees a normal Anthropic-compatible endpoint and routes through it.

## Required env (what Genesis writes)

```json
{
  "env": {
    "ANTHROPIC_BASE_URL":   "http://localhost:11434",
    "ANTHROPIC_AUTH_TOKEN": "ollama",
    "ANTHROPIC_API_KEY":    "",
    "ANTHROPIC_MODEL":                    "kimi-k2.5:cloud",
    "ANTHROPIC_DEFAULT_SONNET_MODEL":     "kimi-k2.5:cloud",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL":      "kimi-k2.5:cloud"
  }
}
```

`ANTHROPIC_BASE_URL` may be `http://host.docker.internal:11434` instead — see `docs/wsl-networking.md`.

## Why NOT `https://ollama.com` + API key

Ollama's REST API at `ollama.com` is **not** Anthropic-compatible. Claude Code expects the Anthropic-message schema, which the **local daemon** synthesises but the cloud REST endpoint does not. Point Claude Code at the daemon, let the daemon call the cloud.

## Recommended models

| Task                  | Model                  |
|-----------------------|------------------------|
| Orchestration / lead  | `kimi-k2.5:cloud`      |
| Heavy reasoning       | `gpt-oss:120b-cloud`   |
| Fast workers          | `glm-5:cloud`          |
| Coding                | `minimax-m2.7:cloud`   |

Model list shifts monthly — check `ollama list` after signing in.
