import { runContractAddressBackfill } from '../src/services/contract-address-backfill';

runContractAddressBackfill()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
