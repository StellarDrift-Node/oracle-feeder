import json
from statistics import median
from typing import Dict, List

import tqdm
from ccxt import ExchangeError, ExchangeNotAvailable, DDoSProtection, BaseError, RequestTimeout, NetworkError

import ccxt

from .sdr import get_sdr_rates

EXCHANGE_BLACKLIST = ['coingi', 'jubi', 'coinegg']
UPDATING_CURRENCIES = ['USD', 'KRW', 'CHY', 'JPY', 'EUR', 'GBP']

LUNA_DENOM = "ETH"


# ------------------------------------------------------------------------------

def filter_exchanges() -> Dict[str, List[ccxt.Exchange]]:
    """
    filtering exchanges, has fetch_ticker for luna/currency
    :return:
    filtered exchanges
    """

    exchanges: Dict[str, List[ccxt.Exchange]] = {}

    for currency in UPDATING_CURRENCIES:
        symbol = f"{LUNA_DENOM}/{currency}"
        exchanges[symbol] = []

    print("Checking available exchanges --")

    exchange_tqdm = tqdm.tqdm(ccxt.exchanges, "Checking available exchanges")
    for exchange_id in exchange_tqdm:
        exchange_tqdm.set_description_str(f"Checking '{exchange_id}' ")

        if exchange_id in EXCHANGE_BLACKLIST:
            continue

        exchange = getattr(ccxt, exchange_id)()
        try:
            markets = exchange.fetch_markets()
            if type(markets) == dict:
                markets = list(markets.values())

            if len(markets) == 0 or type(markets) != list or type(markets[0]) != dict:
                print(markets)
                print("Internal Error: Markets type mismatched on ", exchange_id)
                raise TypeError

            for market in markets:
                if 'symbol' not in market:
                    print(market)
                    print("Internal Error: Market type mismatched on ", exchange_id)
                    raise TypeError

                symbol = market['symbol']
                if symbol in exchanges and hasattr(exchange, 'fetch_ticker'):
                    exchanges[symbol].append(exchange)
        except BaseError:
            pass

    return exchanges


def get_data(exchanges: Dict[str, List[ccxt.Exchange]]):
    sdr_rates = get_sdr_rates()

    result = []
    nodata = []

    sdr_result = []

    success_count = 0
    fail_count = 0

    currency_tqdm = tqdm.tqdm(UPDATING_CURRENCIES, "Fetching")
    for currency in currency_tqdm:
        currency_tqdm.set_description_str(f"Currency '{currency}'")

        symbol = f"{LUNA_DENOM}/{currency}"
        values = []

        sdr_rate = sdr_rates.get(currency, 0)

        exchange_tqdm = tqdm.tqdm(exchanges[symbol])
        for exchange in exchange_tqdm:
            exchange_tqdm.set_description_str(f"Updating from '{exchange.id}'")

            try:
                last = exchange.fetch_ticker(symbol).get('last', 0)
                values.append(1 / last)  # LUNA/CURRENCY <=> CURRENCY/LUNA

                if sdr_rate:
                    sdr_result.append(1 / (last * sdr_rate))

                success_count += 1

            except (ExchangeError, DDoSProtection, ExchangeNotAvailable, RequestTimeout, NetworkError):
                fail_count += 1

            except Exception as e:
                print(f"{symbol}/{exchange.id}")
                raise e

        if values:
            result.append({
                "currency": currency,
                "price": str(median(values))
            })
        else:
            nodata.append(currency)

    # Post processing
    if sdr_result:
        sdr_price = median(sdr_result)

        result.append({
            "currency": "SDR",
            "price": str(sdr_price)
        })

        # fill-in
        for currency in nodata:
            sdr_rate = 1/sdr_rates.get(currency, 0)

            result.append({
                "currency": currency,
                "price": str(sdr_price * sdr_rate)
            })


    # Information printing
    print("")
    print(f"Success: {success_count}, Fail: {fail_count}")

    return result


# ------------------------------------------------------------------------------


def main():
    exchanges = filter_exchanges()
    for symbol, exchange in exchanges.items():
        print(f"{symbol} : {len(exchange)} exchanges")

    result = get_data(exchanges)

    print(json.dumps(result))


# ------------------------------------------------------------------------------

if __name__ == '__main__':
    main()
