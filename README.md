# limp

Self-hosted music streaming server with encrypted transport, offline playback, and multi-user support. Runs on [Bun](https://bun.sh).

Default streams: audio + album art encrypted chunk-by-chunk with AES-256-GCM. Client proxies through a service worker for offline playback (PWA). Admin panel for uploading music, managing users, and organizing albums.

---

## Quickstart

```bash
bun run setup.js   # installs deps, builds the client
bun run start      # starts the server on http://localhost:8080
```

Open `http://localhost:8080/login` — sign in as **admin** with password **1234asdf**.

---

## Default logins

| Role | Username | Password | Notes |
|---|---|---|---|
| Admin | `admin` | `1234asdf` | Auto-created on first run |
| User | *(any created by admin)* | `idgaf` | All regular users share this password |

**How auth works:** There are two global passwords, not per-user passwords. The `ADMIN_PASSWORD` gives admin access, the `USER_PASSWORD` gives regular-user access. The username passed at login picks which user record to authenticate as. This means every regular user logs in with the same password (`idgaf` by default).

---

## Changing passwords

Passwords are set in **`server/config.ts`**:

```ts
export const USER_PASSWORD = process.env.USER_PASSWORD ?? 'idgaf';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '1234asdf';
```

Change the defaults in that file, or override them via environment variables:

```bash
USER_PASSWORD=myuserpass ADMIN_PASSWORD=myadminpass bun run start
```

When using Docker Compose, set them in a `.env` file or edit `docker-compose.yml`:

```yaml
environment:
  - USER_PASSWORD=myuserpass
  - ADMIN_PASSWORD=myadminpass
```

---

## Docker

The app runs in a fully self-contained Docker container — Bun runtime, all npm packages, and the pre-built client are baked into the image. No internet needed at runtime.

### Quick run

```bash
docker compose up -d
```

This builds the image, starts the server on port 8080, and mounts `./data` so your database and music persist across restarts.

### Build the image

```bash
docker build -t limp .
```

### Run manually

```bash
docker run -d -p 8080:8080 -v ./data:/app/data limp
```

### Export for offline distribution (thumbdrive)

The image contains everything needed to run — you can save it to a file and hand it to someone. They only need Docker installed, no internet required.

```bash
./export-docker.sh          # builds image, exports limp.tar
```

Copy `limp.tar` to a thumbdrive. On the target machine:

```bash
docker load < limp.tar
docker run -d -p 8080:8080 -v ./data:/app/data limp:latest
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Port the server listens on |
| `USER_PASSWORD` | `idgaf` | Password for regular users |
| `ADMIN_PASSWORD` | `1234asdf` | Password for admin users |
| `MUSIC_DIR` | `./data/music` | Directory for uploaded music and art |

---

## File structure

```
limp/
├── client/          SvelteKit SPA (UI, playback, offline storage)
├── server/          Bun HTTP server (API, auth, encryption, streaming)
├── data/            Runtime data (SQLite DB, uploaded music & art)
├── Dockerfile       Multi-stage container build
├── docker-compose.yml
├── export-docker.sh Build + export image as portable tar
├── setup.js         One-time install + build
└── package.json     Root scripts (setup, build, start, test)
```
