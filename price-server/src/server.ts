import * as http from 'http'
import * as polka from 'polka'
import * as send from '@polka/send-type'
import * as bluebird from 'bluebird'
import * as config from 'config'
import * as logger from 'lib/logger'
import PricesProvider from './provider/PricesProvider'
import { convertFiatToLunc } from 'provider/luncConverter'
import { countAllRequests } from 'lib/metrics'
import { getBaseCurrency, getQuoteCurrency } from 'lib/currency'

bluebird.config({ longStackTraces: true })

export async function createServer(): Promise<http.Server> {
  const app = polka({})

  app.use(countAllRequests())

  app.get('/health', (req, res) => {
    res.end('OK')
  })

  app.get('/latest', (_, res) => {
    const cryptoPrices = PricesProvider.getCryptoPrices()
    const luncFiatPrices = convertFiatToLunc(cryptoPrices, PricesProvider.getFiatPrices())

    const prices = [
      ...Object.keys(cryptoPrices).map((symbol) => ({
        denom: getBaseCurrency(symbol),
        price: cryptoPrices[symbol],
      })),
      ...Object.keys(luncFiatPrices).map((symbol) => ({
        denom: getQuoteCurrency(symbol),
        price: luncFiatPrices[symbol],
      })),
    ]

    send(res, 200, {
      created_at: new Date().toISOString(),
      prices,
    })
  })

  const server = http.createServer(app.handler)

  server.listen(config.port, () => {
    logger.info(`price server is listening on port ${config.port}`)
  })

  return server
}
