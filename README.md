# Bloxy

Bloxy is a website-based AI Roblox game builder. The website creates a short pairing code; the user enters it in the Roblox Studio plugin; Gemini generates a declarative build blueprint; and the plugin previews every action before the user applies it.

The deployed GitHub Pages website is the standalone marketing page in `landing/index.html`. It uses plain HTML, CSS, and JavaScript with no build step. `.github/workflows/pages.yml` publishes that folder as the live Bloxy website on every relevant push.

## Safety and cost controls

- Gemini credentials stay in the server environment and never reach GitHub client code, Roblox, or players.
- The default model is `gemini-3.1-flash-lite` with a 2,048-token output ceiling.
- Pairing sessions expire after one hour and permit at most 40 generation requests.
- The plugin accepts only allowlisted instance classes and blocks dangerous Luau patterns.
- Generated builds require an explicit Apply click and create Studio undo waypoints.
- One Bloxy Bit represents one cent of metered AI usage. Pro renewals grant 2,200 Bits.
- Every charge is enforced by the backend and recorded in an append-only ledger. Failed AI requests are refunded automatically.
- Current prices: blueprint 1 Bit, thumbnail 4 Bits, basic 3D 10 Bits, textured 3D 30 Bits, and premium 3D 50 Bits.

## Setup

1. Deploy the website and add `GEMINI_API_KEY` as a server secret.
2. Replace `WEBSITE_URL` in `roblox-plugin/Bloxy.plugin.lua` with the deployed HTTPS address.
3. Install the Luau file as a local Roblox Studio plugin.
4. Enable **Allow HTTP Requests** in Studio's Game Settings.
5. Open the website, enter its pairing code in the plugin, and review builds before applying them.

The plugin is a Studio development tool. Do not place it inside a published Roblox experience.

## Private thumbnail reference library

`reference-assets/` may contain locally supplied Roblox rig `.blend` files and face decal PNGs. It is intentionally excluded from Git because the supplied rig pack prohibits redistribution. The files are never uploaded automatically.

There is no default rig or face. For every thumbnail, Bloxy analyzes the requested genre, character role, emotion, pose, scene, headline, and composition; ranks the private rig and face library; and proposes the best matching references. The user can override either recommendation before generation. Only the two approved references are sent for that request, and the face remains a flat decal rather than being redrawn as modeled geometry.
