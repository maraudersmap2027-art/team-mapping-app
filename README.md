# Team Mapping Platform

Mobile-first shared team map and communications platform.

## Stack
- React + TypeScript + Vite
- Supabase Auth, Postgres, Realtime, and Storage
- Leaflet + OpenStreetMap (no paid map API)
- Capacitor Android packaging

## Implemented foundation
- Email/password authentication and handle-based profile creation
- Team creation and invite-code joining
- Shared team map with GPS location publishing
- Realtime refresh for location and map-pin changes
- Initial RLS-protected database schema
- Responsive mobile interface
- GitHub Actions workflow to build a web bundle and debug APK

Messaging, PTT audio, camera uploads, AI photo titles, proximity alerts, and production APK signing are later implementation stages. They are not yet complete.

## Configure Supabase
1. Open your Supabase project.
2. Apply the SQL files in `supabase/migrations/` in filename order using the Supabase SQL Editor.
3. In Project Settings > API, copy the Project URL and publishable key.
4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as GitHub Actions repository variables (Settings > Secrets and variables > Actions > Variables).
5. Never use a service-role or secret key in frontend environment variables.
6. Confirm the `public` schema is exposed through the Data API. New Supabase projects may require explicit exposure and grants.

## Run locally
```sh
npm install
cp .env.example .env
npm run dev
```

## Build
```sh
npm run typecheck
npm run build
```

## Android
The GitHub Actions workflow creates the Android project in CI and builds a debug APK. Download it from the successful workflow run's Artifacts section. A debug APK is installable for testing; production distribution requires a signed release build and secure signing credentials.
