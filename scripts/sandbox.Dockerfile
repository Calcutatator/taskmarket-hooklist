# Runs scripts/cloud-env-setup.sh inside a real Linux container, matching the Linux VM/container
# that script's own header comment says it targets. Lets `make smoke sandbox` verify the full
# script -- including the native-Postgres install path, which can't run on macOS -- without
# needing a real cloud agent sandbox.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl git ca-certificates sudo build-essential openssl unzip python3 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash sandbox \
    && echo "sandbox ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/sandbox

USER sandbox
WORKDIR /home/sandbox/taskmarket
ENV NVM_DIR=/home/sandbox/.nvm

# Real cloud agent sandboxes (Claude Code cloud, Codex cloud) ship with Node.js
# preinstalled via nvm under the agent's own user, so a plain `npm install -g` never
# needs root -- cloud-env-setup.sh assumes exactly that (it only installs
# pnpm/bun/foundry itself). A root-owned system Node install (e.g. via apt) breaks
# that assumption with EACCES, so use nvm here instead to match.
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
    && . "$NVM_DIR/nvm.sh" && nvm install 24

COPY --chown=sandbox:sandbox . .

ENTRYPOINT ["/bin/bash", "-c"]
CMD [". $NVM_DIR/nvm.sh && nvm use 24 && ./scripts/cloud-env-setup.sh && (make smoke bounty || (echo '--- /tmp/backend.log ---'; cat /tmp/backend.log; exit 1))"]
