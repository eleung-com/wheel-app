# wheel-app

Options wheel tracker — a React dashboard plus a Cloudflare Worker that watches
the same conditions on a schedule and messages Telegram. Trades are placed in
Fidelity; nothing here touches a broker.

**All source lives in [`wheel-app/`](wheel-app/)** — see its
[README](wheel-app/README.md) for how the pieces fit together, what makes a
signal, and setup.

```bash
cd wheel-app
npm install
npm run dev    # http://localhost:5173
```

| | |
|---|---|
| App | <https://eleung-com.github.io/wheel-app/> — deploys automatically on push to `main` |
| Worker | `wheel-tradier-proxy` — **deployed by hand**, see [`wheel-app/worker/README.md`](wheel-app/worker/README.md) |
| Tests | `npm test` and `npm run test:worker`, both gated on every PR by [`ci.yml`](.github/workflows/ci.yml) |

> After merging anything under `wheel-app/worker/` or `wheel-app/src/lib/`, run
> `cd wheel-app && npx wrangler deploy`. CI posts a reminder on those PRs.
> Skipping it leaves the app and your alerts running different versions of the
> signal engine.

Historical planning documents live in [`wheel-app/docs/`](wheel-app/docs/) and
are marked as superseded where they no longer describe the system.
