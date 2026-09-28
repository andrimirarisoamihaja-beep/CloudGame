# Cloud Sculptor

**A contemplative browser game about sculpting volumetric clouds in a living sky — no score, no timer, no game over. Only light, weather and time.**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fandrimirarisoamihaja-beep%2FCloudGame&env=DATABASE_URL&envDescription=Neon%20PostgreSQL%20connection%20string%20(postgresql%3A%2F%2Fuser%3Apass%40ep-xxx.aws.neon.tech%2Fcloud_sculptor%3Fsslmode%3Drequire)&envLink=https%3A%2F%2Fconsole.neon.tech)

<!-- Replace with a real capture of the running game. -->
![Cloud Sculptor — screenshot placeholder](./docs/screenshot-placeholder.svg)

---

## What it is

You are given a sky. Click and hold to puff a cloud up, drag to pull its shape,
right-click to fracture it, scroll to make it thick or wispy. Drag two clouds
together and they merge. Double-click the empty sky and a new one is born.

Meanwhile the world keeps going: five minutes of real time is a full day. Wind
builds, humidity gathers, thick clouds start to rain, storms flash, the valley
below grows new trees where the rain fell, and a rainbow fades in when the sun
drops low just as the rain stops.

Nothing is scored. Nothing can be lost.

## Controls

| Gesture | Effect |
| --- | --- |
| Left click + hold on a cloud | Inflate the nearest part of it |
| Left click + drag | Stretch that part toward the cursor |
| Right click | Fracture — split the nearest blob in two |
| Scroll up / down | Densify / dissipate (below `0.1` the cloud is gone) |
| Double click the sky | Create a new cloud |
| Drag a cloud onto another | Merge them |
| Tools (bottom centre) | Puff · Shape (grab the middle to fly a cloud) · Carve · Dissipate |
| Touch | Tap = inflate, two-finger drag = stretch, pinch = density |

There is no tutorial: the cursor changes over a cloud, and every icon explains
itself on hover.

## Running it locally

```bash
git clone https://github.com/andrimirarisoamihaja-beep/CloudGame.git
cd CloudGame
npm install
cp .env.example .env.local   # add your Neon connection string
npm run dev
```

Open <http://localhost:3000>. The game runs without `DATABASE_URL` too — the
gallery falls back to a per-deployment scratch store and says so.

## Deploying

1. **Create a database** — free at the [Neon dashboard](https://console.neon.tech).
   Copy the pooled connection string; it looks like
   `postgresql://user:pass@ep-xxx.aws.neon.tech/cloud_sculptor?sslmode=require`.
2. **Deploy** — click the Vercel button above, or import the repo. Vercel detects
   Next.js and needs no configuration.
3. **Set one environment variable** — `DATABASE_URL`, in *Project → Settings →
   Environment Variables*.
4. **Visit `/api/db/migrate`** once. It creates both tables
   (`CREATE TABLE IF NOT EXISTS`) and reports what it found. Every other route
   calls the same idempotent bootstrap lazily, so this is a convenience rather
   than a requirement.

That is the whole deploy: one variable, zero config, no OAuth, no storage bucket,
no cron.

## How it works

### Volumetric clouds (the heart of it)

Each cloud is a bounding sphere whose fragment shader raymarches a field of up to
eight "blobs":

- the **blob field** is a soft union of spheres — this is exactly what sculpting
  edits;
- a **5-octave fBm** of 3D simplex noise erodes that field, and its domain drifts
  with `u_time` so the cloud is never still;
- `u_density` controls how hard the noise erodes: dense is a solid cumulus, thin
  is a cirrus wisp;
- lighting marches a few steps toward the sun for self-shadowing and adds a
  Henyey–Greenstein forward-scatter term for the silver lining;
- output is **premultiplied**, which makes `src + dst * (1 - src.a)` the
  physically correct compositing equation.

Empty pockets are skipped without evaluating noise, and an adaptive quality
controller walks the raymarcher down a ladder of step counts, octaves and device
pixel ratio whenever frame time slips, so it stays smooth on a laptop and on a
phone.

### The simulation

Everything that changes every frame lives in `lib/engine.ts` as plain mutable
data. One `useFrame` in `components/WeatherSystem.tsx` advances time, the weather
state machine (`CLEAR → CLOUDY → OVERCAST → RAIN → STORM`), wind from fBm,
humidity, rainfall, lightning, the rainbow, the aurora and the landscape's
growth; every 3D component reads that state directly. React only re-renders when
the *structure* changes — a cloud is born, merges or dissolves — or when a
throttled snapshot is handed to the store for the HUD. Sculpting never touches
React state at all.

### Sound

Tone.js synthesises everything at runtime; there is not one audio file in the
repository. A three-oscillator pad breathes with the wind, each cloud hums a note
tuned by its shape (round and dense → 100–200 Hz sine, stretched and thin →
400–800 Hz triangle), rain is filtered noise, thunder is a low-passed noise
burst fired by lightning. The AudioContext is created inside a user gesture when
you first unmute.

### Persistence

Drizzle ORM over the Neon serverless HTTP driver — stateless per request, which
is exactly what Vercel functions want.

| Route | Purpose |
| --- | --- |
| `GET /api/skies` | Newest skies (limit 50) with reaction counts |
| `POST /api/skies` | Save a sky (zod-validated: name, screenshot data URL, cloud state, weather, minute of day) |
| `GET /api/skies/[id]` | One sky |
| `DELETE /api/skies/[id]` | Delete a sky (reactions cascade) |
| `POST /api/skies/[id]/react` | Add a reaction — icon validated against an allowlist |
| `GET /api/db/migrate` | Idempotent schema bootstrap + health report |

Screenshots are stored as downscaled JPEG **data URLs** in Postgres: no blob
store, no external host, no second service to configure.

## Project layout

```
app/            routes, API handlers, global CSS (Tailwind v4 theme lives here)
components/     R3F scene (Sky, Sun, Cloud, CloudManager, Landscape, WeatherSystem, Particles)
                UI/ (HUD, Toolbar, SaveButton, ChallengeToast) · Gallery/ (SkyCard, ReactionBar)
lib/            db, schema, repository, store (zustand), engine, weather, terrain, noise, audio, capture
shaders/        GLSL as TypeScript template literals (cloud, sky, aurora, rainbow)
docs/           screenshot placeholder
```

## Tech stack

Next.js 15 (App Router) · TypeScript (strict) · Three.js + @react-three/fiber +
drei · inline GLSL · Tone.js 15 · Drizzle ORM + Neon serverless · Tailwind CSS v4
· zustand 5 · lucide-react · html2canvas · zod · Vercel.

A few deliberate details, all in service of "one environment variable, zero
config":

- **Tailwind is configured in `app/globals.css`.** Tailwind v4 is CSS-first, so
  there is no `tailwind.config.ts` — the `@theme` block *is* the config.
- **Drizzle talks to Neon over `neon-http`.** It is the serverless-appropriate
  driver; the schema and the SQL are identical either way.
- **No external assets.** Every visual is a shader, a geometry or a gradient;
  every sound is synthesised; the only font stack is the one already on your
  machine (Georgia for the title, system sans for the UI). Drop files into
  `public/fonts/` if you want to change that.
- **No emoji anywhere.** Every icon is a lucide-react component.

## Scripts

```bash
npm run dev        # local development
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
```

---

Made to be looked at slowly.
