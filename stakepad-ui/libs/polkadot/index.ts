export const AppName = 'Phala Stakepad'

export { ApiPromiseProvider, useApiPromise } from './hooks/api'
export { usePolkadot } from './hooks/legacyPolkadotContext'
export type { IPolkadotContext, PolkadotReadystate } from './hooks/legacyPolkadotContext'
export { useWeb3, Web3Provider } from './hooks/web3'
