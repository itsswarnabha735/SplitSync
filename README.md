# SplitSync (Web)

SplitSync is an expense-splitting app for groups and one-on-one friends, with a
greedy debt-simplification solver and multi-currency support. This repository
hosts the **Next.js web app**, backed by Cloud Firestore and Firebase Auth.

The original Android (Kotlin/Jetpack Compose) app has been archived under
[`legacy-android/`](legacy-android/). The Firestore schema and security rules
are shared between both clients.

## Tech stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** (Radix primitives)
- **Zustand** for transient UI state
- **Firebase** client SDK: Auth (Email/Password + Google) and Firestore
  (real-time `onSnapshot` listeners with a persistent local cache)

## Project layout

```
src/
  app/                     # App Router pages
    login/                 # Auth screen
    (app)/                 # Authenticated route group (auth guard in layout.tsx)
      dashboard/           # Groups + Friends + Settings
      groups/create/       # Create group
      groups/[groupId]/    # Group detail (Ledger/Balances/Solver/Settlements)
        add-expense/       # Add expense form
  components/              # UI + feature components (ui/ = shadcn primitives)
  hooks/                   # Real-time Firestore hooks + auth context
  services/                # Firestore repository + auth + doc converters
  lib/                     # Models, debt-simplifier, balances, splits, firebase
  stores/                  # Zustand UI store
firestore.rules            # Shared security rules (unchanged from Android)
firestore.indexes.json     # Shared composite indexes
apphosting.yaml            # Firebase App Hosting config
```

## Getting started

### 1. Install

```bash
npm install
```

### 2. Configure Firebase

This repo shipped with a **placeholder** Firebase project. To run against a real
backend:

1. Create (or reuse) a Firebase project and register a **Web app**
   (Console → Project Settings → Your apps → Web).
2. Enable the **Email/Password** and **Google** sign-in providers
   (Console → Authentication → Sign-in method).
3. Copy `.env.local.example` to `.env.local` and fill in your web config:

```bash
cp .env.local.example .env.local
```

4. Update [`.firebaserc`](.firebaserc) with your real project id.

### 3. Run

```bash
npm run dev          # http://localhost:3000
```

Optionally run against local emulators (set
`NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` in `.env.local`):

```bash
npm run emulators    # firebase emulators:start (auth + firestore)
```

## Scripts

| Script              | Description                          |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Start the dev server                 |
| `npm run build`     | Production build                     |
| `npm run start`     | Serve the production build           |
| `npm test`          | Run unit tests (Vitest)              |
| `npm run lint`      | Lint                                 |
| `npm run emulators` | Start Firebase emulators             |

## Tests

Pure business logic is unit-tested with Vitest:

- `src/lib/debt-simplifier.test.ts` — greedy debt solver (multi-currency,
  rounding, debtor/creditor matching).
- `src/lib/splits.test.ts` — equal/exact split distribution and validation.

```bash
npm test
```

## Deploy (Firebase App Hosting)

1. Push this repo to GitHub.
2. In the Firebase console, create an **App Hosting** backend and connect the
   repository.
3. Set the `NEXT_PUBLIC_FIREBASE_*` environment variables on the backend (see
   [`apphosting.yaml`](apphosting.yaml)).
4. Deploy the shared Firestore rules/indexes:

```bash
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

## Data model

Firestore collections (shared with the legacy Android app):

```
/groups/{groupId}
/groups/{groupId}/members/{memberId}
/groups/{groupId}/expenses/{expenseId}      # splits embedded as { memberId: amount }
/groups/{groupId}/payments/{paymentId}
/users/{uid}                                # public profile (lookup by email)
/users/{uid}/friends/{friendId}
/users/{uid}/adhocExpenses/{expenseId}      # splits embedded; "self" = you
/users/{uid}/adhocPayments/{paymentId}
/users/{uid}/groupInvites/{groupId}
```
