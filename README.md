# Binance P2P Arbitraging App

Very simple arbitrage.

* Primarily Uses the [api.wise.com](https://wise.com/) service for calculating the exchange rates between the buy and sell currency.
* If the primary API is not available then the app uses the [api.exchangerate.host](https://exchangerate.host/) service for calculating the exchange rates between the buy and sell currency,
* And the [Binance P2P API](https://p2p.binance.com/) for converting between the buy and sell currency.

# Setup

Copy or rename the `.env.sample` file to `.env`, and change the defaults as needed.

Then, run `npm run start` or `npm run nodemon` (rebuilds automatically on changes).

# Demo App

https://talented-dove-overcoat.cyclic.app/


