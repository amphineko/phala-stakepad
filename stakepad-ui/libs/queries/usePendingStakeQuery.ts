import { ApiPromise } from '@polkadot/api'
import { AccountId, BalanceOf } from '@polkadot/types/interfaces'
import { encodeAddress } from '@polkadot/util-crypto'
import { Decimal } from 'decimal.js'
import { useQuery, UseQueryResult } from 'react-query'
import { v4 as uuidv4 } from 'uuid'
import { bnToDecimal } from '../utils/balances'
import { useDecimalJsTokenDecimalMultiplier } from './useTokenDecimals'

interface PendingStake {
    staking?: BalanceOf
    unstaking?: BalanceOf

    balance: Decimal
}

interface UseStakerPendingTotalQueryResult {
    balance: Decimal
    count: number
}

const decimalZero = new Decimal(0)

const StakerPendingQueryKey = uuidv4()

export const useStakerPendingsQuery = (staker?: AccountId | string, api?: ApiPromise): UseQueryResult<Record<string, PendingStake>> => {
    const tokenDecimals = useDecimalJsTokenDecimalMultiplier(api)

    return useQuery(
        [StakerPendingQueryKey, staker, api],
        async () => {
            if (api === undefined || staker === undefined || tokenDecimals === undefined) { return undefined }

            return await Promise.all([
                api.query.miningStaking.pendingStaking.entries(staker),
                api.query.miningStaking.pendingUnstaking.entries(staker)
            ]).then(([stakes, unstakes]) => {
                const result: Record<string, PendingStake> = {}
                stakes.forEach(([{ args: [, miner] }, balance]) => {
                    const stake = balance.unwrapOrDefault()
                    result[encodeAddress(miner)] = {
                        balance: bnToDecimal(stake, tokenDecimals),
                        staking: stake
                    }
                })
                unstakes.forEach(([{ args: [, miner] }, balance]) => {
                    const address = encodeAddress(miner)
                    const unstake = balance.unwrapOrDefault()
                    const deciamlUnstake = bnToDecimal(unstake, tokenDecimals)

                    const previous = result[address] ?? { balance: decimalZero }
                    result[address] = {
                        ...previous,
                        balance: previous.balance.sub(deciamlUnstake),
                        unstaking: unstake
                    }
                })

                return result
            })
        }
    )
}

export const useStakerPendingTotalQuery = (staker?: AccountId | string, api?: ApiPromise): UseStakerPendingTotalQueryResult | undefined => {
    const { data: pendings } = useStakerPendingsQuery(staker, api)

    if (pendings === undefined) { return undefined }

    const entries = Object.entries(pendings).filter(([, { balance }]) => !balance.isZero())
    return {
        balance: entries.reduce((acc, [, { balance }]) => acc.add(balance), decimalZero),
        count: entries.length
    }
}

export const useStakePendingQuery = (staker?: string, miner?: string, api?: ApiPromise): PendingStake | undefined => {
    const { data } = useStakerPendingsQuery(staker, api)
    return miner !== undefined ? data?.[miner] : undefined
}
