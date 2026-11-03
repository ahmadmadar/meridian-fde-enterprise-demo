# Two stages: build compiles TypeScript with the full dev toolchain; the
# runtime image keeps only production dependencies and the compiled output.
# `prisma` (migrate deploy on boot) and `tsx` (the seed script) are runtime
# dependencies in package.json for exactly that reason.

FROM node:24-slim AS build
# Prisma's engines need OpenSSL; the slim image doesn't ship it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# Drop devDependencies, then regenerate the client against the pruned tree.
RUN npm prune --omit=dev && npx prisma generate

FROM node:24-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist

# The node user ships with the image; nothing here needs root.
USER node

EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
