import pQueue from 'p-queue'
import { ApiPromise, WsProvider } from '@polkadot/api'
import Demical from 'decimal.js'
import types from '../typedefs.json'
import BN from 'bn.js'
import { node }  from '../config/index.js'
import { RealtimeRoundInfo } from '../models/realtimeRoundInfo.js'
import { HistoryRoundInfo } from '../models/historyRoundInfo.js'
import { createLogger } from 'bunyan'
import { getTokenInfo } from '../servers/tokeninfo.js'


const { default: Queue } = pQueue

const ONE_THOUSAND = new BN('1000', 10)
const ZERO = new BN('0')
const LAST_BLOCK = 1477800 //todo use the newest blockhight from blockchain
const LAST_ROUND = 2472
const DEFAULT_OUTPUT = 'null'
const ROUND_CYCLE_TIME = 3600

const queue = new Queue({
  timeout: 90000,
  throwOnTimeout: false,
  concurrency: 1
})

globalThis.$logger = createLogger({
  level: 'info',
  name: 'dashboard'
})

let jsonOutput = DEFAULT_OUTPUT
let lastBlockHeader
let _status = null


export const main = async () => {
  const provider = new WsProvider(node.WS_ENDPOINT)
  const api = await ApiPromise.create({ provider, types })
  globalThis.api = api

  let roundStartAt = 0
  let currentRound = 0

  const [phalaChain, phalaNodeName, phalaNodeVersion] = (await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version()
  ])).map(i => i.toString())
  $logger.info({ chain: phalaChain }, `Connected to chain ${phalaChain} using ${phalaNodeName} v${phalaNodeVersion}`)

  return api.rpc.chain.subscribeNewHeads(async header => {
    const number = header.number.toNumber()

    console.log("#### get number", number);

    if (number > LAST_BLOCK) {
      if (jsonOutput !== DEFAULT_OUTPUT) { return }
      if (!lastBlockHeader) {
        const lastBlockHeaderHash = await api.rpc.chain.getBlockHash(LAST_BLOCK)
        lastBlockHeader = await api.rpc.chain.getHeader(lastBlockHeaderHash)
      }
      return queue.add(() => processRoundAt(lastBlockHeader, LAST_ROUND, api).catch(console.error))
    }

    if (number === roundStartAt) {
      return queue.add(() => processRoundAt(header, currentRound, api).catch(console.error))
    }

    const events = await api.query.system.events.at(header.hash)

    let hasEvent = false

    events.forEach(record => {
      const { event } = record

      if (event.section === 'phalaModule' && event.method === 'NewMiningRound') {
        hasEvent = true
        currentRound = event.data[0].toNumber()
        $logger.info(`Starting round #${currentRound} at block #${number + 1}...`)
      }
    })

    if (hasEvent) {
      roundStartAt = number + 1
    } else {
      if (!(roundStartAt && currentRound)) {
        roundStartAt = number + 1
        const roundInfo = await api.query.phalaModule.round.at(header.hash)
        currentRound = roundInfo.round.toNumber()
        $logger.info(`Starting round #${currentRound} at block #${roundInfo.startBlock.toNumber()}...`)
      }
    }
  })
}

const processRoundAt = async (header, roundNumber, api) => {
  const blockHash = header.hash
  const accumulatedFire2 = (await api.query.phalaModule.accumulatedFire2.at(blockHash)) || new BN('0')
  const accumulatedFire2Demical = new Demical(accumulatedFire2.toString())
  const onlineWorkers = await api.query.phalaModule.onlineWorkers.at(blockHash)
  const totalPower = await api.query.phalaModule.totalPower.at(blockHash)

  const stashAccounts = {}
  const stashKeys = await api.query.phalaModule.stashState.keysAt(blockHash)
  const stashCount = stashKeys.length
  console.log("####1 stashAccounts");
  await Promise.all(
    (stashKeys)
      .map(async k => {
        const stash = k.args[0].toString()
        const value = (await api.rpc.state.getStorage(k, blockHash)).toJSON()
        stashAccounts[stash] = {
          controller: value.controller,
          payout: value.payoutPrefs.target,
          commission: value.payoutPrefs.commission,
          stake: 0,
          workerStake: 0,
          userStake: 0,
          stakeAccountNum: 0,
          overallScore: 0
        }
      }))

  const payoutAccounts = {}
  console.log("####2 payoutAccounts");
  await Promise.all(
    (await api.query.phalaModule.fire2.keysAt(blockHash))
      .map(async k => {
        const account = k.args[0].toString()
        const value = await api.rpc.state.getStorage(k, blockHash)
        const fire2 = value.toString()
        payoutAccounts[account] = {
          ...payoutAccounts[account],
          account,
          fire2,
          fire2Human: value.toHuman().replace(/PHA$/, '').replace(' ', ''),
          workerCount: 0,
          payoutComputeReward: 0
        }
      }))

  console.log("####3 payoutComputeReward");
  await Promise.all(
    (await api.query.phalaModule.payoutComputeReward.keysAt(blockHash))
      .map(async k => {
        const account = k.args[0].toString()
        const value = await api.rpc.state.getStorage(k, blockHash)
        const payoutComputeReward = value.toNumber() || 0

        if (!payoutAccounts[account]) { return }
        payoutAccounts[account] = {
          ...payoutAccounts[account],
          payoutComputeReward
        }
      })
  )

  console.log("####4 workerState");
  const validStashAccounts = {}
  let accumulatedScore = 0
  await Promise.all(
    (await api.query.phalaModule.workerState.keysAt(blockHash))
      .map(async k => {
        const stash = k.args[0].toString()
        const payout = stashAccounts[stash].payout
        const value = (await api.rpc.state.getStorage(k, blockHash)).toJSON()
        stashAccounts[stash].overallScore = value.score.overallScore

        if (typeof value.state.Mining === 'undefined') { return }
        accumulatedScore += value.score.overallScore

        validStashAccounts[stash] = stashAccounts[stash]

        if (payoutAccounts[payout]) {
          payoutAccounts[payout] = {
            ...payoutAccounts[payout],
            workerCount: payoutAccounts[payout].workerCount + 1
          }
        }
      }))

  console.log("####5 payoutAccount.stake");
  let accumulatedStake = undefined  
  await Promise.all(
    (await api.query.miningStaking.stakeReceived.keysAt(blockHash))
      .map(async k => {
        const stash = k.args[0].toString()
        const stashAccount = stashAccounts[stash]

        if (!stashAccount) { return }

        // const value = (await api.rpc.state.getStorage(k, blockHash)).div(ONE_THOUSAND)
        const value = (await api.rpc.state.getStorage(k, blockHash))
        accumulatedStake = typeof accumulatedStake === 'undefined'
          ? value : accumulatedStake.add(value)

        const payout = stashAccount.payout
        const payoutAccount = payoutAccounts[payout]

        if (!payoutAccount) { return }
        if (!value) { return }

        stashAccount.stake = value.add(stashAccount.stake  || ZERO)
        payoutAccount.stake = value.add(payoutAccount.stake || ZERO)
      })
  )

  await Promise.all(
    (await api.query.miningStaking.staked.keysAt(blockHash))
    .map(async k => {   
        const from = k.args[0].toString()
        const to = k.args[1].toString()     
        const value = (await api.rpc.state.getStorage(k, blockHash))

        const stash = to.toString()
        const stashAccount = stashAccounts[stash]

        if (!stashAccount) { return }

        stashAccount.stakeAccountNum = stashAccount.stakeAccountNum? (stashAccount.stakeAccountNum + 1): 1;

        if (from.toString() === to.toString()) {
          stashAccount.workerStake = value.add(stashAccount.workerStake  || ZERO)
        } else {
          stashAccount.userStake = value.add(stashAccount.userStake  || ZERO)
        }
      })
  )

  console.log("####6 count stake");
  accumulatedStake = accumulatedStake || new BN('0')
  const accumulatedStakeDemical = new Demical(accumulatedStake.toString())
  Object.entries(payoutAccounts).forEach(([k, v]) => {
    const value = payoutAccounts[k].stake || new BN('0')
    const valueDemical = new Demical(value.toString())

    payoutAccounts[k].stake = value.toString()
    payoutAccounts[k].stakeHuman = api.createType('BalanceOf', payoutAccounts[k].stake).toHuman().replace(/PHA$/, '').replace(' ', '').trim()
    payoutAccounts[k].stakeRatio = valueDemical.div(accumulatedStakeDemical).toNumber()
  })

  console.log("####7 count stake reward");
  const avgStakeDemical = accumulatedStakeDemical.div(stashCount)
  const avgStake = avgStakeDemical
    .div(1000)
    .div(1000)
    .div(1000)
    .div(1000)
  
  const avgreward = accumulatedFire2Demical.div(stashCount)
    .div(1000)
    .div(1000)
    .div(1000)
    .div(1000);

  const accumulatedFire2PHA = accumulatedFire2Demical
    .div(1000)
    .div(1000)
    .div(1000)
    .div(1000)

  const stakeSum = accumulatedStakeDemical
    .div(1000)
    .div(1000)
    .div(1000)
    .div(1000);

  const stakeSupplyRate = async function(stakeSumPHA) {
    const tokeninfo = await getTokenInfo()
    const available_supply = tokeninfo.available_supply
    if (0 === available_supply) {
      return 0
    }
    
    return stakeSum.div(available_supply)
  }

  const output = {
    roundNumber,
    updatedAt: Date.now(),
    accumulatedFire2: accumulatedFire2.toString(),
    onlineWorkers: onlineWorkers.toString(),
    totalPower: totalPower.toString(),
    accumulatedStake: accumulatedStake.toString(),
    accumulatedStakeHuman: api.createType('BalanceOf', accumulatedStake).toHuman().replace(/PHA$/, '').replace(' ', '').trim(),
    stashAccounts: validStashAccounts,
    payoutAccounts,
    stashCount,
    avgStakeDemical,
    avgStake: parseFloat(avgStake),
    avgScore: accumulatedScore / onlineWorkers.toNumber()
  }

  let workers = []
  //for (var [key, value] of stashAccounts) {
  Object.keys(stashAccounts).map(function(key, index) {
    let value = stashAccounts[key];
    const accumulatedStake = new Demical(value.stake.toString())
      .div(1000)
      .div(1000)
      .div(1000)
      .div(1000)

    const workerStake = new Demical(value.workerStake.toString())
      .div(1000)
      .div(1000)
      .div(1000)
      .div(1000)

    const userStake = new Demical(value.userStake.toString())
      .div(1000)
      .div(1000)
      .div(1000)
      .div(1000)

    workers.push({
      stashAccount: key,
      controllerAccount: value.controller,
      payout: value.payout,
      accumulatedStake: accumulatedStake,
      workerStake: workerStake,
      userStake: userStake,
      stakeAccountNum: value.stakeAccountNum,
      commission: value.commission,
      taskScore: value.overallScore  + 5 * Math.sqrt(value.overallScore) ,
      machineScore: value.overallScore,
      onlineReward: 1021,   //todo 等待后端合约完善
      computeReward: 22,    //todo 等待后端合约完善
      reward: 12345,        //todo 等待后端合约完善
      apy: 1,            //todo@@ 根据mongodb历史数据完善 看看产品更新公式
      penalty: 0 // todo 等待后端合约完善
    });
  });

  async function getLastRoundReward(round) {
    let historyRoundInfo = await HistoryRoundInfo.findOne({round: round - 1});
    if (!historyRoundInfo) {
      return 0;
    }
    return historyRoundInfo.accumulatedFire2;
  }

  //jsonOutput = JSON.stringify(output)
  let realtimeRoundInfo = await RealtimeRoundInfo.findOne({});
  if (!realtimeRoundInfo) {
    realtimeRoundInfo = new RealtimeRoundInfo({
      round: roundNumber,
      avgStake: avgStake,
      avgreward: avgreward,
      accumulatedFire2: accumulatedFire2PHA,
      roundCycleTime: ROUND_CYCLE_TIME, //use 1 hour this time
      onlineWorkerNum: onlineWorkers,
      workerNum: stashCount,
      stakeSum: stakeSum, 
      stakeSupplyRate: await stakeSupplyRate(),
      rewardLastRound: await getLastRoundReward(),
      blocktime: null,
      workers: workers
    });
  } else {
    console.log("#before insert", roundNumber, avgStake);
    realtimeRoundInfo.set({
      round: roundNumber,
      avgStake: avgStake,
      avgreward: avgreward,
      accumulatedFire2: accumulatedFire2PHA,
      roundCycleTime: ROUND_CYCLE_TIME, //use 1 hour this time
      onlineWorkerNum: onlineWorkers,
      workerNum: stashCount,
      stakeSum: stakeSum, 
      stakeSupplyRate: await stakeSupplyRate(),
      rewardLastRound: await getLastRoundReward(),
      blocktime: null,
      workers: workers
    });
  }

  await realtimeRoundInfo.save();

  $logger.info(`Updated output from round #${roundNumber}.`)
}


export const init = async()=> {
}

export default {init, main};
