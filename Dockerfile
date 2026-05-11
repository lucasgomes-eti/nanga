FROM node:22-slim

# ffmpeg: necessario para decodificar/encodar audio do Discord
# python3 + pip: necessarios pelo yt-dlp (sera adicionado na etapa de musica)
# ca-certificates: TLS para chamadas HTTPS
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        python3-pip \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
CMD ["node", "src/index.js"]
