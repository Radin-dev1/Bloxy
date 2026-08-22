# Bloxy

Bloxy is a website-based AI Roblox game builder. The website creates a short pairing code; the user enters it in the Roblox Studio plugin; Gemini generates a declarative build blueprint; and the plugin previews every action before the user applies it.

Blueprint generation runs a multi-stage pipeline (`lib/bridge.ts`, `generateBlueprint`): a design-planning pass first commits to a theme, palette, zones, landmark, and player route; a build pass then emits actions against that plan (anchored by a worked construction exemplar); and a deterministic geometry audit measures the result — heavy cross-structure overlaps, unsupported floating parts, oversized palettes, over-scattered layouts — feeding up to three AI refinement rounds until the audit passes. Revisions are only accepted when they score at least as well as the current draft.

The deployed GitHub Pages website is the standalone marketing page in `landing/index.html`. It uses plain HTML, CSS, and JavaScript with no build step. `.github/workflows/pages.yml` publishes that folder as the live Bloxy website on every relevant push.

## Safety and cost controls

- Gemini credentials stay in the server environment and never reach GitHub client code, Roblox, or players.
- The default model is `gemini-3.6-flash`, falling back to `gemini-3.1-flash-lite` on failure, with a 16,384-token output ceiling.
- Pairing sessions expire after one hour and permit at most 40 generation requests.
- The plugin accepts only allowlisted instance classes and blocks dangerous Luau patterns.
- Generated builds require an explicit Apply click and create Studio undo waypoints.
- One Bloxy Bit represents one cent of metered AI usage. A planned Pro renewal will grant 2,200 Bits; this is not yet purchasable.
- Every charge is enforced by the backend and recorded in an append-only ledger. Failed AI requests are refunded automatically.
- Live prices (`lib/bits.ts`, `ACTION_COSTS`): blueprint 1 Bit, 3D asset generation (text, image, or doodle) 6 Bits flat. `thumbnail` (4 Bits), `3d_basic` (4 Bits), and `3d_premium` (10 Bits) are defined in the cost table but not yet wired to a route — every `/api/3d/generate` call currently charges the `3d_textured` rate regardless of quality.

## Setup

1. Deploy the website and add `GEMINI_API_KEY` as a server secret.
2. Replace `WEBSITE_URL` in `roblox-plugin/Bloxy.plugin.lua` with the deployed HTTPS address.
3. Install the Luau file as a local Roblox Studio plugin.
4. Enable **Allow HTTP Requests** in Studio's Game Settings.
5. Open the website, enter its pairing code in the plugin, and review builds before applying them.

The plugin is a Studio development tool. Do not place it inside a published Roblox experience.

## Accounts

Email/password sign-in works out of the box — no configuration needed. OAuth sign-in (Roblox, Discord, Google) requires registering an app with each provider and setting its client ID/secret as Worker secrets (see `.env.example`). For each provider, the redirect URI to register is:

```
https://<your-worker-domain>/api/auth/oauth/<provider>/callback
```

where `<provider>` is `roblox`, `discord`, or `google`. A provider button on the sign-in modal is inert (its `/start` route redirects back with an error) until that provider's secrets are set — the other sign-in methods keep working independently. Signed-in Bits balances renew monthly via a Cloudflare Cron Trigger (`worker/index.ts`'s `scheduled` handler, declared in `vite.config.ts`); the trigger runs daily and tops up any account whose `renews_at` has passed, so no one waits more than a day past their actual renewal date.

## Worlds and Explore

Signed-in creators can save the current build as a world (`worlds` table; blueprint JSON plus a small canvas-snapshot thumbnail stored inline in D1), reopen it later from the workspace's Worlds panel, and publish it. Published worlds appear on the public Explore page (`landing/explore/index.html`), which lists them newest-first or by play count. Opening someone else's world loads it read-into-canvas at `workspace/?world=<id>` and counts a play; saving it again creates the visitor's own remix copy. The landing page and Explore both carry a prompt box that deep-links into the workspace via `workspace/?prompt=<text>` and starts generation immediately.

## Private thumbnail reference library

`reference-assets/` may contain locally supplied Roblox rig `.blend` files and face decal PNGs. It is intentionally excluded from Git because the supplied rig pack prohibits redistribution. The files are never uploaded automatically.

There is no default rig or face. For every thumbnail, Bloxy analyzes the requested genre, character role, emotion, pose, scene, headline, and composition; ranks the private rig and face library; and proposes the best matching references. The user can override either recommendation before generation. Only the two approved references are sent for that request, and the face remains a flat decal rather than being redrawn as modeled geometry.
