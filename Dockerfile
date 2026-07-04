FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV PORT=8080
ENV ROOMS_DIR=/data/rooms
EXPOSE 8080
CMD ["node", "scripts/online-server.js"]
