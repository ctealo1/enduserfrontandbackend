# BayaniHub Web App (Frontend + Backend)

This project has two parts:
- `./` (root): Next.js frontend
- `./backend`: NestJS API (used by login/signup/forgot password)

## Prerequisites

- Node.js 18+ (Node 20 recommended)
- npm 9+

## Environment Files

### 1) Frontend env (root)
Create `./.env.local` with:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
```

### 2) Backend env (`backend` folder)
Create `./backend/.env` with:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
PORT=3001
FRONTEND_URL=http://localhost:3000
```

Important:
- `SUPABASE_SERVICE_ROLE_KEY` must stay in backend only. Never put it in frontend files.
- If frontend runs on a different port (for example `3002`), update `FRONTEND_URL` to match exactly.

## Install Dependencies

From project root:

```bash
npm install
cd backend
npm install
cd ..
```

## Run the System (Local)

Use two terminals.

### Terminal 1: Start backend

```bash
cd backend
npm run start:dev
```

Backend should run at: `http://localhost:3001/api/v1`

### Terminal 2: Start frontend

```bash
npm run dev
```

Frontend should run at: `http://localhost:3000`

## Login Flow Check

1. Open `http://localhost:3000/login`
2. Log in with valid credentials
3. You should be redirected to `/` (homepage)

## Common Issues

### 1) `Unable to acquire lock ... .next/dev/lock`
Another Next.js dev server is running. Stop it, then run again.

Git Bash:

```bash
taskkill //F //IM node.exe
rm -f .next/dev/lock
npm run dev
```

### 2) CORS or failed login request
- Make sure backend is running on `3001`
- Make sure `NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1`
- Make sure `backend/.env` has `FRONTEND_URL` matching your actual frontend URL
- Restart backend and frontend after env changes

### 3) Frontend auto-opens homepage
If you were already logged in, local storage token may still exist.
Clear these keys in browser local storage:
- `bayanihub-web-token`
- `bayanihub-web-auth`

Then reload and test login again.
