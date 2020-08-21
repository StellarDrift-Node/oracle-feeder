import { BigNumber } from 'bignumber.js'
import { uniq, concat } from 'lodash'
import { format, addMinutes, isSameMinute, isSameDay } from 'date-fns'
import * as config from 'config'
import { createReporter } from 'lib/reporter'
import { average } from 'lib/statistics'
import * as logger from 'lib/logger'
import { PriceBySymbol, Trades } from './types'
import Quoter from './Quoter'

export class Provider {
  protected quoters: Quoter[] = []
  protected symbols: string[] = []
  protected priceBySymbol: PriceBySymbol = {}
  private reporter
  private reportedAt = 0

  public async initialize(): Promise<void> {
    for (const quoter of this.quoters) {
      await quoter.initialize()
    }
    this.symbols = uniq(concat(...this.quoters.map((quoter) => quoter.getSymbols())))
  }

  public async tick(now: number): Promise<boolean> {
    const responses = await Promise.all(this.quoters.map((quoter) => quoter.tick(now)))
    let isUpdated = false

    // if some quoter updated
    if (responses.some((response) => response)) {
      this.adjustPrices()
      isUpdated = true
    }

    // report the prices
    if (config.report) {
      this.report(now)
    }

    return isUpdated
  }

  public getPriceBy(symbol: string): BigNumber {
    return this.priceBySymbol[symbol]
  }

  public getPrices(): PriceBySymbol {
    return this.priceBySymbol
  }

  // collect latest trade records
  protected collectTrades(symbol: string): Trades {
    return concat(...this.quoters.map((quoter) => quoter.getTrades(symbol) || []))
  }

  protected collectPrice(symbol: string): BigNumber[] {
    return this.quoters.map((quoter) => quoter.getPrice(symbol)).filter((price) => price)
  }

  protected adjustPrices(): void {
    // calculate average of prices
    for (const symbol of this.symbols) {
      delete this.priceBySymbol[symbol]

      const prices: BigNumber[] = this.collectPrice(symbol)

      if (prices.length > 0) {
        this.priceBySymbol[symbol] = average(prices)
      }
    }
  }

  private report(now: number): void {
    if (isSameMinute(now, this.reportedAt)) {
      return
    }

    try {
      if (!this.reporter || !isSameDay(now, this.reportedAt)) {
        this.reporter = createReporter(
          `report/${this.constructor.name}_${format(now, 'MM-dd_HHmm')}.csv`,
          [
            'time',
            ...this.symbols,
            ...concat(
              ...this.quoters.map((quoter) =>
                concat(
                  ...quoter.getSymbols().map((symbol) => `${quoter.constructor.name}\n${symbol}`)
                )
              )
            ),
          ]
        )
      }

      const report = {
        time: format(Math.floor(addMinutes(now, -1).getTime() / 60000) * 60000, 'MM-dd HH:mm'),
      }

      // report adjust price
      for (const symbol of this.symbols) {
        report[symbol] = this.priceBySymbol[symbol]?.toFixed(8)
      }

      // report quoter's price
      for (const quoter of this.quoters) {
        for (const symbol of quoter.getSymbols()) {
          const key = `${quoter.constructor.name}\n${symbol}`
          report[key] = quoter.getPrice(symbol)?.toFixed(8)
        }
      }

      this.reporter.writeRecords([report])
    } catch (error) {
      logger.error(error)
    }

    this.reportedAt = now
  }
}

export default Provider