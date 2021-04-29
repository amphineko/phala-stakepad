import { InjectedAccountWithMeta } from '@polkadot/extension-inject/types'
import { createContext, PropsWithChildren, ReactElement, useContext, useEffect, useState } from 'react'

export type Readystate = 'disabled' | 'enabling' | 'ready' | 'failed'

interface IWeb3Context {
    accounts: InjectedAccountWithMeta[]
    readystate: Readystate
}

const Web3Context = createContext<IWeb3Context>({
    accounts: [],
    readystate: 'disabled'
})

const logDebug = console.debug.bind(console, '[Web3Context]')
const logError = console.error.bind(console, '[Web3Context]')

export const Web3Provider = ({ children, originName }: PropsWithChildren<{ originName: string }>): ReactElement => {
    const [accounts, setAccounts] = useState<InjectedAccountWithMeta[]>([])
    const [readystate, setState] = useState<Readystate>('disabled')

    useEffect(() => {
        if (typeof window === 'undefined' || readystate !== 'disabled') {
            // do not enable during server side rendering
            return
        }

        setState('enabling')

        import('@polkadot/extension-dapp')
            .catch(reason => {
                logError('Failed to import @polkadot/extension-dapp:', reason)
                setState('failed')
                throw reason
            })

            .then(({ web3Enable }) => {
                web3Enable(originName).then(extensions => {
                    logDebug('Injected extensions:', extensions.map(ext => `${ext.name}@${ext.version}`).join(', '))
                    setState('ready')
                }).catch(reason => {
                    logError('Failed to enable web3:', reason)

                })
            })
            .catch(reason => {
                logError('Failed to enable web3:', reason)
                setState('failed')
            })
    }, [originName, readystate])

    useEffect(() => {
        if (typeof window === 'undefined' || readystate !== 'ready') {
            // do not subscribe until web3 is ready
            return
        }

        const unsubPromise = import('@polkadot/extension-dapp')
            .catch(reason => {
                logError('Failed to import @polkadot/extension-dapp:', reason)
                throw reason
            }).then(async ({ web3Accounts, web3AccountsSubscribe }) => {
                // subscribe to account list updates
                const unsub = await web3AccountsSubscribe(accounts => { setAccounts(accounts) })
                    .catch(reason => {
                        logError('Failed to subscribe to account list updates:', reason)
                    })

                // and manually update the list once
                web3Accounts()
                    .then(accounts => { setAccounts(accounts) })
                    .catch(reason => { logError('Failed to read accounts:', reason) })

                return unsub
            })

        return () => {
            unsubPromise
                .then(unsub => typeof unsub === 'function' && unsub())
                .catch(reason => {
                    logError('Failed to unsubscribe to account injections:', reason)
                })
        }
    }, [readystate])

    return (<Web3Context.Provider value={{ accounts, readystate }}>{children}</Web3Context.Provider>)
}

export const useWeb3 = (): IWeb3Context => useContext(Web3Context)
