# Build status

Last updated: 2026-11-11

## Committed to GitHub
- Vite + React + TypeScript app foundation
- Supabase client setup through environment variables
- Email/password sign-in and account creation
- Team creation and invite-code join flows
- GPS location publishing and realtime map refresh
- Initial database schema and follow-up RLS hardening migrations
- Responsive map dashboard
- Capacitor configuration
- GitHub Actions workflow intended to build the web app and a debug APK

## Not complete yet
- Supabase project connection and migration application
- Live text/direct messaging interface
- Push-to-talk audio recording and playback
- Photo capture, storage upload, and AI-generated titles
- Secure nearby claim workflow and proximity notifications
- Public web deployment
- Signed production APK

## Important security notes
- The browser client uses only a Supabase publishable key.
- Service-role/secret keys must never be placed in frontend variables.
- GPS-based proximity is a convenience signal, not proof of physical presence; a robust claim system needs server-side validation and anti-spoofing measures.
- Storage buckets and object policies must be created before media uploads are enabled.
