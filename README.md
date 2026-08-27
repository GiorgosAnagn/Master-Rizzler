# Master Rizzler

Master Rizzler is a mobile-friendly group scoring app. Accounts use Supabase Auth. Each group has a six-digit code, join requests require admin approval, and group admins can create, edit, and remove signed point rules. Positive values are tasks; negative values are punishments. History is append-only and scores are derived from point events.

## Supabase setup

1. Open the Supabase project used by Vercel.
2. Open **SQL Editor**.
3. Run the complete `supabase_schema.sql` file. It is rerunnable and moves the original fixed-player tables to `legacy_players` and `legacy_point_events` if they are still present.
4. In **Authentication > Providers**, enable Email sign-ups.
5. Decide whether to require email confirmation. If enabled, registration shows a confirmation message and the user must confirm before signing in.
6. Re-running this SQL also adds `point_events`, `group_tasks`, and `group_members` to the `supabase_realtime` publication.
7. Re-running this SQL enables full replica identity so Realtime delete events can refresh other devices correctly.

## Vercel environment variables

Keep these in the Vercel project settings for Production and Preview:

- `SUPABASE_URL`: the base project URL, such as `https://project-ref.supabase.co`
- `SUPABASE_ANON_KEY`: the public anon or publishable key used for Supabase Auth
- `SUPABASE_SERVICE_ROLE_KEY`: the server-only service role or secret key
- `ADMIN_TOKEN`: legacy reset token; the new group workflow uses group roles

Never commit the service key or put it in the HTML.

The browser uses `SUPABASE_ANON_KEY` through the server's public `/api/state?action=config` response for password recovery and Realtime. No service key is returned to the browser.

## Deployment

Vercel is connected to the GitHub repository. The repository root is the project root, and `vercel.json` rewrites `/` to `master_rizzler.html`. Deploy after the schema has been run. The `identity-main` folder is a reference project and is not required by this app.

## App workflow

1. A visitor sees the account gate and registers or signs in.
2. A player creates a group or enters a six-digit code to request membership.
4. The group owner accepts pending requests and can promote active members to admins.
5. Owners and admins add tasks or punishments using one description and one signed point value. They can edit or delete rules; existing history remains unchanged.
6. Any active member selects the player who completed a rule and adds the event. The leaderboard, history, and summary update from the server.
7. Owners and admins can delete an accidental history entry. The event is removed and the leaderboard is recalculated from the remaining events for every group member.

## Profile pictures

The account lobby accepts an HTTPS profile image URL. The leaderboard displays it and falls back to initials. For production uploads, use a public Supabase Storage bucket and paste the public object URL into the profile field.

## Validation performed locally

- Browser smoke test: the login gate loads from the local HTML and register mode toggles correctly.
- Editor diagnostics: no errors in the HTML, API, or SQL files.
- Deployment JSON parsing: `package.json`, `vercel.json`, and `manifest.webmanifest` parse successfully.
- Git whitespace check: `git diff --check` passes.

A live Supabase insert/auth test requires your project credentials and must be run after applying the SQL migration.
