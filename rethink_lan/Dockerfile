FROM ghcr.io/home-assistant/base:latest AS build

WORKDIR /build/rethink

RUN apk add --no-cache \
    nodejs \
    npm

COPY app/package.json app/package-lock.json ./
RUN npm ci --ignore-scripts

COPY app/ ./
RUN npm run build \
  && npm prune --omit=dev \
  && rm -rf /root/.npm

FROM ghcr.io/home-assistant/base:latest

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
  io.hass.name="Rethink LAN" \
  io.hass.description="Local LAN server for LG ThinQ devices" \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${BUILD_ARCH}"

WORKDIR /opt/rethink

RUN apk add --no-cache \
    nodejs \
    openssl

COPY --from=build /build/rethink/package.json /build/rethink/package-lock.json ./
COPY --from=build /build/rethink/node_modules ./node_modules
COPY --from=build /build/rethink/dist ./dist

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]
