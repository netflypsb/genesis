# WSL networking for Genesis

Genesis' default provider is **Ollama Cloud via the local Ollama desktop app** on Windows. Claude Code (running inside WSL) must be able to reach that Windows-side daemon at port `11434`.

There are three ways to do it. Genesis picks one automatically based on your `%UserProfile%\.wslconfig`.

## 1. Mirrored networking (recommended)

With mirrored networking, `localhost` inside WSL is the same `localhost` as Windows. Zero extra config.

Add to `%UserProfile%\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```

Then run `wsl --shutdown` once. The wizard will do this for you if you accept the prompt in Phase 0.

## 2. host.docker.internal (fallback)

Stock WSL2 exposes the Windows host as `host.docker.internal`. Genesis uses `http://host.docker.internal:11434` when mirrored networking is not enabled. This works out of the box on recent WSL2 builds.

## 3. OLLAMA_HOST=0.0.0.0 (manual)

If neither of the above works, bind Ollama to all interfaces:

- Windows → set environment variable `OLLAMA_HOST=0.0.0.0:11434`
- Restart the Ollama app.

Then the wizard's `host.docker.internal:11434` resolver will reach it.

## Verifying

Inside WSL:

```bash
curl -s http://localhost:11434/api/tags          # mirrored mode
curl -s http://host.docker.internal:11434/api/tags   # fallback
```

Either should return JSON listing your local + cloud models.
