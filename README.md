# USWT Membership Dues Tracker

React + Turso (libSQL) app for managing the USWT national dues billing contract: chapters, member rosters, quarterly billing sheets, monthly recaps, and new-member intake.

## One-time setup

### 1. Create the Turso database

If you don't already have the Turso CLI:
```
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
```

Then create a dedicated database for this app:
```
turso db create uswt-dues-tracker
turso db shell uswt-dues-tracker < schema.sql
```

Get the connection details you'll need for the next step:
```
turso db show uswt-dues-tracker --url
turso db tokens create uswt-dues-tracker
```

### 2. Local development

Copy `.env.example` to `.env` and fill in the two values from above:
```
cp .env.example .env
```
```
VITE_TURSO_URL=libsql://uswt-dues-tracker-yourusername.turso.io
VITE_TURSO_AUTH_TOKEN=eyJ...
```

Then:
```
npm install
npm run dev
```

### 3. Deploy to GitHub Pages

In the repo's Settings → Secrets and variables → Actions, add two repository secrets:
- `VITE_TURSO_URL`
- `VITE_TURSO_AUTH_TOKEN`

In Settings → Pages, set the source to **GitHub Actions**.

Push to `main` — the included workflow (`.github/workflows/deploy.yml`) builds and deploys automatically. The site will be live at:
```
https://jengrovdahl.github.io/uswt-dues-tracker/
```

## Notes

- **SSN field**: present in the schema (`members.ssn`) but left as the contract-allowed `"0"` placeholder by default. Since Turso has no row-level security — anyone with the auth token embedded in the built JS can read the whole database — don't start entering real SSNs here without adding a backend proxy first. Ask me when you're ready for that.
- **New-member intake** is currently manual entry (seeded with two example rows so you can see the approve flow). Wiring it to auto-fill from the real USWT add-form email is a follow-up once you can show me what that email looks like.
- Trimester due dates live in the `trimesters` table — update or add rows there each Women of Today year rather than editing code.
