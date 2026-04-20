# Sunstone Federal Intelligence Platform

Multi-tenant federal contracting intelligence engine. Built on PRD v1.4.

## Stack

- React 18 + Vite + TypeScript
- Tailwind CSS (design tokens via CSS variables)
- Zustand (state)
- Supabase (Postgres + Auth + Storage + RLS)
- Netlify (hosting, auto-deploy from `main`)

## Local development

```bash
npm install
npm run dev
```

Requires the following environment variables (set in `.env.local`):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Database setup

See `supabase/migrations/0001_v2_schema.sql`. Run in the Supabase SQL Editor for project `acvbqfrpiusjiawotrsm`.

After migration: add `v2` to exposed schemas in Project Settings > API.

## Protocols (PRD v1.4)

- **P5** — every deploy verified by commit hash on Netlify before claimed complete
- **P8** — source lives in GitHub, deploys trigger from `git push origin main`
- **P9** — `npm run check:tenants` runs before every deploy to block tenant name leaks
- **P10** — every new build session re-verifies IP-1 through IP-5

## Day 1 scope

- Auth (email/password, Google OAuth, magic link)
- Tenant resolution states A / B / C with blocking picker modal
- Apple Minimalist design system (DS-1 through DS-11)
- Role model (SuperAdmin / Admin / User) enforced via RLS
- Placeholder dashboard shell

Features land progressively per PRD v1.4 Application Structure section.
