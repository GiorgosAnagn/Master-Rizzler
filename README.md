# Master Rizzler deployment

This is a static Vercel app with a small Vercel serverless API and Supabase as the source of truth. The existing scoring values remain unchanged and are stored as simple points. The browser no longer stores the shared score in `localStorage`.

## Supabase

1. Create a Supabase project.
2. Open **SQL Editor**, paste `supabase_schema.sql`, and run it.
3. Copy the project URL and the service role key from **Project Settings > API**. The service role key is server-only and must never be placed in the HTML or committed to GitHub.

## Vercel

1. Push this folder to a GitHub repository.
2. Import the repository into Vercel. No build command is required.
3. Add these Production environment variables in Vercel:
   - `SUPABASE_URL`: your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: your Supabase service role key
   - `ADMIN_TOKEN`: a private random value used only for Reset Game
4. Deploy. Vercel will serve `master_rizzler.html` and `/api/state`.

The root file is named `master_rizzler.html`; set the Vercel project output to the repository root. For the cleanest home-screen URL, rename it to `index.html` after confirming the repository setup, or configure a rewrite to it.

## iPhone

Open the deployed HTTPS URL in Safari, tap **Share**, then **Add to Home Screen**. The manifest, status-bar metadata, and icon make it open like an app.

## Profiles and avatars

The `players` table already has an `avatar_url` column. To add profile pictures without changing the UI, upload public images to Supabase Storage and update each player's `avatar_url` in the table. The leaderboard will show the image and use initials when the URL is empty.

For a public game, keep `ADMIN_TOKEN` private and do not expose the Supabase service role key. The current write endpoint is intentionally simple and public; the next security upgrade would be Supabase Auth plus an admin/player role if the app needs protection from unauthorised point entries.