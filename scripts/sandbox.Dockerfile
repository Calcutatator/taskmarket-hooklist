# Runs scripts/cloud-env-setup.sh inside a real Linux container, matching the Linux VM/container
# that script's own header comment says it targets. Lets `make smoke sandbox` verify the full
# script -- including the native-Postgres install path, which can't run on macOS -- without
# needing a real cloud agent sandbox.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl git ca-certificates sudo build-essential openssl \
    && rm -rf /var/lib/apt/lists/*

# Real cloud agent sandboxes (Claude Code cloud, Codex cloud) ship with Node.js
# preinstalled -- cloud-env-setup.sh assumes npm is already on PATH (it only installs
# pnpm/bun/foundry itself), so match that here rather than changing the script.
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash sandbox \
    && echo "sandbox ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/sandbox

USER sandbox
WORKDIR /home/sandbox/taskmarket

COPY --chown=sandbox:sandbox . .

ENTRYPOINT ["/bin/bash", "-c"]
CMD ["./scripts/cloud-env-setup.sh && make smoke bounty"]
