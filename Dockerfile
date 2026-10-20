# Cápárium nAPPló: production image (Next.js standalone + Prisma migrations on start).
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx prisma generate && npm run build && npm run build:seed

# production dependencies only (includes the Prisma CLI for "migrate deploy" with its own dependencies)
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM base AS run
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# the static files of public/ (the home page's pictures, caparium-hibak-5): the standalone output does not carry
# them, and without this line every /kezdolap/*.webp was a 404 on the stage (#34)
COPY --from=build --chown=node:node /app/public ./public
# ... and the image proves it: the pictures are where the server serves public/ from. The e2e runs `next start`,
# which serves public/ from the source tree, so it could not see this; a missing picture stops the build.
RUN for f in nagymedencek kismedencek heti adagolas kalkulator kivetel egyedi evesi; do test -s "public/kezdolap/$f.webp" || { echo "missing public/kezdolap/$f.webp in the image" >&2; exit 1; }; done
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/dist ./dist
# the PDF typeface with its licence (src/lib/pdf-font.ts reads it from the working directory)
COPY --from=build --chown=node:node /app/assets ./assets
# the image proves at build time that the water report PDF can be made here (review of #32: the e2e runs `next
# start`, not this image): pdfkit resolves from these node_modules with its own data files, and the copied font
# parses. A missing font or package stops the build instead of the first button press. That the font CARRIES
# "ő"/"ű" is not measured here (a missing glyph is silent): the unit test reads the PDF back, on the same blob.
RUN node -e "const P=require('pdfkit');const d=new P();d.registerFont('b','assets/fonts/DejaVuSans.ttf');d.font('b').text('Hőmérséklet Sűrűség');d.on('data',()=>{});d.end()"
COPY --from=build --chown=node:node /app/scripts/start.sh ./start.sh
# the generated client with its query engine (generated in the build stage)
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "start.sh"]
