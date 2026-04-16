FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "start"]
