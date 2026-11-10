FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js braucht NEXT_PUBLIC_* zur Build-Zeit
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Rauchtest (Objekt-Studio Schritt 7, berichtigt in der Nachbesserung infra-1 und im Nachtrag d1-e22-rauchtest-3):
# Der Startbild-Abgleich braucht sharp mit dem nativen musl-Binary aus dem Lock (@img/sharp-linuxmusl-*). sharp 0.35
# lädt ein fehlendes oder nicht ladbares natives Binary NICHT mit einem Fehler, sondern weicht ohne Warnung auf
# WebAssembly (@img/sharp-wasm32) aus. Erkannt an zwei Stellen, wie in sharpNativ (lib/studio/startbild.ts):
# „emscripten“ in sharp.versions (stammt nur aus @img/sharp-wasm32/versions.json) und das tatsächlich geladene Modul
# im CommonJS-Cache — ein Pfad unter @img/sharp-…wasm32 heißt WebAssembly, nativ nur mit geladenem @img/sharp-…/….node.
# Der import-Weg lädt sein Binary über createRequire in denselben Cache. Der Test prüft beide Wege (require und import)
# und lässt den Build sonst scheitern. Versionen und „nativ“ stehen im Build-Log.
RUN node -e "const n = (s, weg) => { const k = Object.keys(require.cache); const wasm = 'emscripten' in s.versions || k.some((p) => p.includes('/@img/sharp-') && p.includes('wasm32')); const nativ = k.some((p) => p.includes('/@img/sharp-') && !p.includes('wasm32') && p.endsWith('.node')); if (wasm || !nativ) throw new Error('sharp (' + weg + ') laeuft nicht nativ: ' + (wasm ? 'WebAssembly geladen' : 'kein natives Binary geladen')); }; n(require('sharp'), 'require'); import('sharp').then((m) => { n(m.default, 'import'); console.log('sharp', m.default.versions.sharp, 'libvips', m.default.versions.vips, 'nativ'); })"
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
