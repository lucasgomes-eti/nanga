FROM node:22-slim

# build-essential: gcc/g++/make para compilar modulos nativos
#   (@discordjs/opus nem sempre tem binario pre-compilado para a combinacao
#    Node + glibc desta imagem, entao precisa compilar do source)
# ffmpeg: necessario para decodificar/encodar audio do Discord
# python3 + pip: necessarios pelo node-gyp e pelo yt-dlp
# ca-certificates: TLS para chamadas HTTPS
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
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
