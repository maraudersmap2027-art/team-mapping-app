# FieldLink — Team Mapping Platform

Mobile-first shared team map and communications platform.

## Stack
- React + TypeScript + Vite
- Supabase Auth, Postgres, Realtime, and private Storage
- Leaflet + OpenStreetMap (no paid map API)
- Capacitor Android packaging

## Implemented
- Email/password authentication and handle-based profile creation
- Team creation and invite-code joining
- Shared team map with GPS location publishing
- Realtime map and team chat updates
- Team text messages and push-to-talk voice notes
- Geotagged photo uploads and map pins
- Private team-media storage with membership-aware access policies
- Nearby pin claim RPC with a 75-metre distance check
- Responsive mobile interface
- GitHub Actions workflow for web bundle and Android debug APK

## Not yet complete
- AI-generated photo titles (photo titles are currently user-entered or timestamp-based)
- One-to-one direct-message recipient selection (current chat is team-wide)
- Claimed-items profile collection (claimed pins are removed from the active map)
- Proximity notifications
- Production-signed Android APK

## Supabase connection
The app is connected to its Supabase project using a browser-safe publishable key. Publishable keys are intended to be public; database RLS and Storage policies enforce access. Never place a service-role or secret key in the frontend.

The migrations in `supabase/migrations/` document the schema, security hardening, private media bucket, and proximity claim RPC. The database changes for this project have already been applied.

## Build
GitHub Actions runs the web build and Android debug APK build on pushes to `main`. Download the APK from the Artifacts section of a successful workflow run. A debug APK is installable for testing; production distribution requires a signed release build and secure signing credentials.
