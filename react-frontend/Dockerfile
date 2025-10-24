### Build stage
FROM node:20.19.0-alpine AS builder
WORKDIR /app

# Enable corepack and prepare yarn so we can use Yarn reliably
RUN corepack enable && corepack prepare yarn@1.22.19 --activate

# Copy package files and yarn.lock for better caching
COPY package.json yarn.lock ./
COPY tsconfig*.json ./

# Install dependencies with yarn (frozen lockfile to respect yarn.lock)
RUN yarn install --frozen-lockfile --silent

# Copy the rest and build
COPY . .
RUN yarn build

### Production image
FROM nginx:stable-alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Custom nginx conf will be added to proxy /api to the backend service
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
