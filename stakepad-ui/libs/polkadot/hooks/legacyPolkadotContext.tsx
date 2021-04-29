import { ApiPromise } from '@polkadot/api'
import { InjectedAccountWithMeta } from '@polkadot/extension-inject/types'
import { useApiPromise } from './api'
import { Readystate, useWeb3 } from './web3'

const readystateMap: Record<Readystate, PolkadotReadystate> = {
    disabled: 'start',
    enabling: 'init',
    failed: 'unavailable',
    ready: 'ready'
}

export type PolkadotReadystate = 'start' | 'init' | 'ready' | 'unavailable'

export interface IPolkadotContext {
    /**
     * Current selected (active) account
     */
    readonly account?: string

    /**
     * All available accounts injected by Polkadot extensions
     */
    readonly accounts?: InjectedAccountWithMeta[]

    /**
     * ApiPromise instance to make calls
     */
    readonly api?: ApiPromise

    /**
     * Readystate of Polkadot web3 extension
     *
     * @see PolkadotReadystate
     */
    readonly readystate: PolkadotReadystate

    enableApi: () => Promise<ApiPromise>

    enableWeb3: () => Promise<InjectedAccountWithMeta[]>

    /**
     * Change the current account to
     */
    setAccount: (account: string) => void
}

export const usePolkadot = (): IPolkadotContext => {
    const { api } = useApiPromise()
    const { accounts, readystate } = useWeb3()

    return {
        api,
        account: undefined,
        accounts,
        readystate: readystateMap[readystate],

        enableApi: async () => await Promise.reject(new Error('Not implemented')),
        enableWeb3: async () => await Promise.reject(new Error('Not implemented')),
        setAccount: () => { throw new Error('Not implemented') }
    }
}
