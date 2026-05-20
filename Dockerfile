# Stage 1: Build the SvelteKit client
FROM oven/bun:1 AS client-builder
WORKDIR /src/client
COPY client/package.json ./
RUN bun install
COPY client/ ./
RUN bun run build

# Stage 2: Production image
FROM oven/bun:1-slim
WORKDIR /app

# Install server dependencies (sharp, fflate)
COPY server/package.json ./server/
RUN cd server && bun install --production && cd ..

# Copy server source
COPY server/ ./server/

# Copy built client (served as static files by the Bun server)
COPY --from=client-builder /src/client/build /app/client/build

# Ensure data directory exists (DB and uploaded music live here)
RUN mkdir -p /app/data

EXPOSE 8080
ENV PORT=8080

CMD ["bun", "run", "server/index.ts"]
