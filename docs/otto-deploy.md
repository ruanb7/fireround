# Otto deployment on Fly.io

This fork (`ruanb7/fireround`, branch `otto-deploy`) runs Fireround as the discovery layer of the
claude-otto validation pipeline. Upstream is `firecrawl/fireround`; `main` tracks it, `otto-deploy`
carries only the files below. Rebase `otto-deploy` on `main` to take upstream changes.

## What is deployed

- App `fireround-otto` on Fly, region `iad`, one `shared-cpu-1x` machine with 2 GB, never
  auto-stopped: the Next.js server ticks its own cron routes hourly (`lib/scheduler.ts`), so a
  stopped machine means no sweeps.
- Database: Fly Postgres `fireround-db` (unmanaged, one node, 1 GB volume) attached to the app,
  which sets `DATABASE_URL` on the internal network with `sslmode=disable`. `DATABASE_DRIVER=pg`.
- Preset: seed and pre-seed only. `presets/series-a-b.json` and `presets/growth.json` are removed
  on this branch so a scheduled sweep spends the one-preset estimate (Lite rung, about 3.3k to
  3.6k Firecrawl credits a month, which fits Firecrawl Hobby).
- Read-back: `RECONCILE_PROVIDER=openrouter`, `RECONCILE_MODEL=openai/gpt-6-luna`.

## Files on this branch

| File | Purpose |
|---|---|
| `Dockerfile` | node 24 slim, pnpm via corepack, frozen install, `pnpm build`, runtime stage |
| `fly/start.sh` | `pnpm db:migrate` then `next start -H 0.0.0.0 -p 3000` |
| `fly.toml` | app, region, env (non-secret), http service, health check, vm size |
| `.dockerignore` | keeps `node_modules`, `.next`, `data`, `.env*` and git out of the build context |
| `docs/otto-deploy.md` | this runbook |

## Secrets (memroy vault name → Fly secret)

| Vault | Fly secret | Set how |
|---|---|---|
| `firecrawl-api-key` | `FIRECRAWL_API_KEY` | obtained through Firecrawl's agent auth flow (`/cli-auth`), stored by the poller, never shown |
| `fireround-cron-secret` | `CRON_SECRET` | generated |
| `fireround-dashboard-password` | `DASHBOARD_PASSWORD` | generated; any username |
| `fireround-mcp-api-key` | `MCP_API_KEY` | generated; bearer for `/api/mcp` |
| `openrouter-api-key` | `OPENROUTER_API_KEY` | shared fleet key |
| (attach) | `DATABASE_URL` | `fly postgres attach fireround-db -a fireround-otto` |

Set them from PowerShell so values never enter a transcript:

```powershell
$lines = @("CRON_SECRET=$(memroy show fireround-cron-secret)", "DASHBOARD_PASSWORD=$(memroy show fireround-dashboard-password)", "MCP_API_KEY=$(memroy show fireround-mcp-api-key)", "OPENROUTER_API_KEY=$(memroy show openrouter-api-key)", "FIRECRAWL_API_KEY=$(memroy show firecrawl-api-key)")
($lines -join "`n") | fly secrets import -a fireround-otto
```

## Operate

```bash
fly deploy --remote-only                      # from the repo root on otto-deploy
fly logs -a fireround-otto                    # "fireround: migrating" then "fireround: starting"
# first sweep (the Lite schedule only sweeps Mondays 06:00 UTC)
curl -H "Authorization: Bearer $(memroy show fireround-cron-secret)" "https://fireround-otto.fly.dev/api/cron/sweep?force=1"
# read rounds (HTTP Basic, any username)
curl -u "otto:$(memroy show fireround-dashboard-password)" "https://fireround-otto.fly.dev/api/v1/rounds?limit=20"
```

MCP: `https://fireround-otto.fly.dev/api/mcp` with `Authorization: Bearer <fireround-mcp-api-key>`.
Feeds: mint a token with `pnpm feed-token` (or in Settings), then `/feeds/<token>/seed.rss`.

## Known limits

- Fly Postgres is unmanaged: no automatic backups beyond volume snapshots. `pnpm backup-db` works
  against the internal host via `fly proxy 15432:5432 -a fireround-db`.
- The Deep rung (publisher sections, Form D lane) is not enabled; it needs Firecrawl Growth-level
  credits. Form D detail is covered by the `mcpwright-edgar` MCP in otto instead.
