FROM node:21-alpine AS build-stage

# Set the working directory in the Docker image
WORKDIR /usr/src/app

# Install pnpm globally using npm
RUN npm install -g corepack && \
  corepack enable

# Copy package files first to leverage Docker cache
COPY package.json pnpm-lock.yaml ./

# Install dependencies with frozen lockfile for consistency
RUN pnpm install --frozen-lockfile

# Copy the rest of the application to the working directory
COPY . .

# Build the application
RUN pnpm run build

FROM node:21-alpine AS production

# Set the working directory in the Docker image
WORKDIR /usr/src/app

# Install pnpm globally using npm
RUN npm install -g corepack && \
  corepack enable

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only with frozen lockfile
RUN pnpm install --frozen-lockfile --prod

# Copy build artifacts from build stage
COPY --from=build-stage /usr/src/app/build .

EXPOSE 3050

CMD ["node", "index.js"]
