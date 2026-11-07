FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10000
ENV RENDER=true
ENV NODE_OPTIONS="--max-old-space-size=384"

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

EXPOSE 10000

CMD ["node", "server.js"]
