# Disposable Anvil chain for per-PR preview environments (docs/specs/agent-preview-environments-rfc.md).
# Never used for real testnet/mainnet — those deploy to Base Sepolia/Base directly.
FROM ghcr.io/foundry-rs/foundry:latest

EXPOSE 8545

ENTRYPOINT ["anvil", "--host", "0.0.0.0", "--port", "8545"]
