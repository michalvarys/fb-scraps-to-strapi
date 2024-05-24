FROM ghcr.io/puppeteer/puppeteer:22.9.0 as base

WORKDIR /app
# We don't need the standalone Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true

COPY package.json yarn.lock ./

RUN rm -rf node_modules && yarn install --frozen-lockfile && yarn cache clean

COPY . .

CMD [ "yarn", "start" ]
