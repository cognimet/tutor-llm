# React + Vite dev container — supplies Node so you don't have to install it.
FROM node:20-alpine

WORKDIR /app

# Install deps first for better caching.
COPY package.json ./
RUN npm install

# App source.
COPY . .

EXPOSE 5173
# --host exposes the dev server outside the container.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
