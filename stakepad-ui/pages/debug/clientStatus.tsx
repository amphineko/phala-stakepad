import { TableBuilder, TableBuilderColumn } from 'baseui/table-semantic'
import { useApiPromise, useWeb3 } from '../../libs/polkadot'

export const PolkadotStatus: React.FC = () => {
    const { api, readystate: apiReadystate } = useApiPromise()
    const { accounts, readystate: web3Readystate } = useWeb3()

    return (
        <div>
            <div>WebSocket API Readystate: {apiReadystate} @ Runtime: {api?.runtimeVersion}, Extrinsic: {api?.extrinsicVersion}</div>
            <div>Web3 Readystate: {web3Readystate}</div>

            <TableBuilder data={accounts} isLoading={web3Readystate !== 'ready'} loadingMessage="Waiting for Web3">
                <TableBuilderColumn header="Address">{(account: typeof accounts[number]) => account.address}</TableBuilderColumn>
                <TableBuilderColumn header="Source">{(account: typeof accounts[number]) => account.meta.source}</TableBuilderColumn>
            </TableBuilder>
        </div>
    )
}
