# Release Plan

## 1. Add Claffy Design System package
- Install the Claffy design system as a package dependency
- Reference site for design: https://anyx402.vercel.app/

## 2. Customize UI to match design
- Apply Claffy design tokens (colors, typography, spacing) to the frontend
- Update components to use design system primitives
- Match the visual style of https://anyx402.vercel.app/

## 3. Rename app to Task Market
- Update app name throughout frontend (page titles, metadata, nav)
- Update any remaining references to old name in docs and config

## 4. Fix connect wallet
- Debug why clicking "Connect Wallet" does nothing
- Verify wagmi/RainbowKit config and provider setup
- Test wallet connection flow end to end

## 5. Add dark/light mode theme selector
- Implement theme toggle in the UI
- Ensure design system tokens support both modes
- Persist user preference

## 6. Deploy backend and database on Railway
- Provision PostgreSQL on Railway
- Deploy backend service on Railway
- Set all required environment variables (see below)

## 7. Set up backend environment variables
- DATABASE_URL
- BASE_RPC_URL
- CONTRACT_ADDRESS
- SERVER_PRIVATE_KEY
- USDC_TOKEN_ADDRESS
- FEE_RECIPIENT_ADDRESS
- X402_FACILITATOR_URL
- R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

## 8. Deploy frontend to Vercel
- Connect repo to Vercel
- Set VITE_API_URL and any other frontend env vars
- Verify production build works end to end
