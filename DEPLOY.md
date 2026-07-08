# Deploying TeamOS

The deployable unit is **`next-app/`** (Next.js 16 web + API). The Android app is a
client that talks to whatever URL `next-app` is hosted at.

## Deploy the web/backend to Vercel (GitHub import)

1. **Push the code** to GitHub (Vercel builds from the repo, not your laptop).
   The production branch is `main`.

2. In the target Vercel account: **Add New… → Project → Import** the
   `Attendence-Pro` GitHub repo.

3. **Configure the project** before the first deploy:
   - **Root Directory: `next-app`**  ← critical; otherwise the build fails.
   - Framework Preset: **Next.js** (auto-detected).
   - Node.js Version: **24.x**.
   - Build/Output/Install: defaults.

4. **Environment Variables** — add every var from
   [`next-app/.env.local.example`](next-app/.env.local.example), copying the
   **values from your current `next-app/.env.local`**. Scope them to
   **Production** (and Preview if you use preview deploys). `NEXT_PUBLIC_*` are
   inlined at build time, so they must exist before you deploy.

   Must-not-get-wrong:
   - `LEXDESK_ORG_ID` — must equal the existing org id, or the site shows **no data**.
   - `QR_TOKEN_SECRET` — must match AttendDesk's value, or QR check-in breaks.
   - `DATABASE_URL` — the Neon **pooled** connection string (host contains
     `-pooler`, `?sslmode=require`). The app **data** lives here (see the Database
     section below). Without it, every data route 500s.
   - `FIREBASE_SERVICE_ACCOUNT` / `STORAGE_FIREBASE_SERVICE_ACCOUNT` — Firebase now
     serves **Auth + profile-photo Storage only** (the data moved to Neon). Same
     Firebase project as today ⇒ logins and photos keep working unchanged.

5. **Deploy**, then **Project → Settings → Domains → Add** `teamos.lexdatalabs.com`.
   Because the `lexdatalabs.com` zone is already on this Vercel account, Vercel
   creates the DNS record + SSL automatically.

6. **Verify**:
   - `curl -o /dev/null -w '%{http_code}' https://teamos.lexdatalabs.com/api/v1/attendance` → **401** (route live, auth-gated).
   - Log in at `https://teamos.lexdatalabs.com` → you should see the existing
     employees/attendance (confirms `LEXDESK_ORG_ID` + service account are right).
   - If client-side Firebase Auth is ever used, add `teamos.lexdatalabs.com` under
     Firebase Console → Authentication → Settings → Authorized domains.

The old `lexdesk-dhaka.vercel.app` project can stay or be deleted — both are just
clients of the same Firebase project.

## Database — Neon Postgres

The app's **data** lives in Neon Postgres (Firestore was retired to escape the
Spark 50K-reads/day cap). **Firebase Auth** (login, ID tokens, custom claims) and
**Firebase Storage** (profile photos) stay on Firebase — no app/APK change, no
user re-login. The join key is `users.firebase_uid` = the Firebase Auth uid.

### One-time provisioning

1. **Provision Neon** via the Vercel Marketplace: Vercel dashboard → your
   `lexdesk` project → **Storage / Integrations → Neon → Create**. Vercel injects
   `DATABASE_URL` (pooled) and usually `DATABASE_URL_UNPOOLED` (direct) into the
   project's env. Copy both into `next-app/.env.local` for local runs.
2. **Apply the schema** (idempotent): run `next-app/db/schema.sql` against the DB
   (Neon SQL editor, or `psql "$DATABASE_URL_UNPOOLED" -f next-app/db/schema.sql`).

### One-time data migration (Firestore → Neon)

Run from `next-app/`, **right after the ~1 PM BDT Spark daily reset** so the export
has a fresh 50K read budget:

```sh
node scripts/migrate-firestore-to-neon.mjs --count      # pre-flight doc counts (cheap)
node scripts/migrate-firestore-to-neon.mjs --dry-run    # transform check, no writes
node scripts/migrate-firestore-to-neon.mjs              # full migration (idempotent)
```

If `--count` reports a total near/over 50K, add `--skip=locationPings` (high-volume
telemetry) to stay under the cap, or run in two post-reset windows. The script
preserves doc ids and prints a per-collection read/written/total reconciliation.

### Cutover (big-bang, ~15–30 min off-peak)

1. Apply `schema.sql` to the **production** Neon DB; deploy the Postgres build to a
   Vercel **preview** and smoke-test it first.
2. After the 1 PM reset, announce a short freeze; run the migration; verify counts.
3. Promote the build to **production** with `DATABASE_URL` set; Firebase Auth/Storage
   env vars unchanged. Verify login + check-in + approvals, then lift the freeze.
4. Leave Firestore in place (read-only backup) for a grace period. **Point of no
   return:** once users write to Postgres, rolling back loses post-cutover writes.

Bootstrap scripts `scripts/seed.mjs` / `scripts/seed-superadmin.mjs` now write the
admin/superadmin row to Postgres (they still create the Firebase Auth user); they
need `DATABASE_URL` too.

## Android app

The app's backend URL is baked in at build time in
[`android/app/build.gradle.kts`](android/app/build.gradle.kts) and now defaults to
`https://teamos.lexdatalabs.com`. Rebuild the APK after the domain is live:

```sh
cd android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:assembleDebug
```

Override per-build if needed (e.g. emulator against local dev):

```sh
./gradlew :app:assembleDebug -PattendDeskApiBase=http://10.0.2.2:3000/api/v1 -PadminWebUrl=http://10.0.2.2:3000
```

## Distribute the APK

The web landing/register page's "download app" button reads
`NEXT_PUBLIC_APP_DOWNLOAD_URL`.

1. Attach the APK to a GitHub Release on `LexData-Labs/lexdesk-app` — name the
   asset **`TeamOS.apk`** and tick **Set as the latest release**.
2. Use the version-proof permalink (survives future releases as long as the
   asset stays named `TeamOS.apk` and the release is marked latest):
   `https://github.com/LexData-Labs/lexdesk-app/releases/latest/download/TeamOS.apk`
3. Set `NEXT_PUBLIC_APP_DOWNLOAD_URL` to that link in Vercel → **redeploy**
   (it's a `NEXT_PUBLIC_*`, inlined at build time, so it only updates on a new build).
4. The repo (or its releases) must be **public** for anonymous downloads.

