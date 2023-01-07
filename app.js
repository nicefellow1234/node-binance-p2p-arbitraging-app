const express = require('express');
const bodyParser = require('body-parser');
const ejs = require('ejs');
const axios = require('axios');

const app = express();
app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: true }));

// Render the app index page
app.get('/', (req, res) => {
  res.render('index');
});

// Calculate the data and return the data in JSON
app.get('/get-results', async (req, res) => {
  let exchangeData = null;
  let buyAmount = req.query.buyAmount;
  let buyCurrency = req.query.buyCurrency;
  let sellCurrency = req.query.sellCurrency;

  // Fetch the fiat exchange data from the API using the buyCurrency & sellCurrency
  await axios
    .get(
      `https://api.exchangerate.host/convert?from=${buyCurrency}&to=${sellCurrency}`
    )
    .then((response) => {
      exchangeData = response.data;
    });

  // Calculate the fiat exchange total amount of the buyAmount
  let fiatTotalAmount = Math.round(buyAmount * exchangeData.info.rate);

  // Fetch buyCurrency P2P data using Wise payment method & buyAmount
  let p2pBuyData = await fetchP2PData('BUY', buyAmount, 'Wise', buyCurrency);

  // Select the first advertisement given it matches with our requirements
  // Also since this would be the best price as well
  let p2pBuyAdv = p2pBuyData.data[0];

  // Calculate the boughtUSDT using the above advertisement price
  let boughtUSDT = buyAmount / p2pBuyAdv.adv.price;

  // Now fetch the sellCurrency P2P data using Bank Transfer payment method & fiatTotalAmount
  let p2pSellData = await fetchP2PData(
    'SELL',
    fiatTotalAmount,
    'BANK',
    sellCurrency
  );

  // Now you need to look for the one ad where you can sell the USDT looking at the limits set by advertisers
  // Once a suitable advertisement has been located then stop looking for more and use that one
  let p2pSellAdv = null;
  for (let i = 0; i < p2pSellData.data.length; i++) {
    let ad = p2pSellData.data[i];
    if (
      ad.adv.minSingleTransQuantity < boughtUSDT &&
      boughtUSDT < ad.adv.maxSingleTransQuantity
    ) {
      p2pSellAdv = ad;
      break;
    }
  }

  // Now calculate the final soldCurrencyAmount using the above selected advertisement price for selling
  let soldCurrencyAmount = boughtUSDT * p2pSellAdv.adv.price;

  // At last return all of the data to be rendered on the frontend
  res.json({
    buyPrice: p2pBuyAdv.adv.price,
    boughtUSDT,
    buyAdvId: p2pBuyAdv.advertiser.userNo,
    buyAdvertiser: p2pBuyAdv.advertiser.nickName,
    sellPrice: p2pSellAdv.adv.price,
    soldCurrencyAmount,
    sellAdvId: p2pSellAdv.advertiser.userNo,
    sellAdvertiser: p2pSellAdv.advertiser.nickName,
    fiatRate: exchangeData.info.rate,
    fiatTotalAmount
  });
});

/**
 * Fetches P2P data from Binance API using the given params
 * @param {*} tradeType
 * @param {*} amount
 * @param {*} paymentMethod
 * @param {*} currency
 * @returns
 */
async function fetchP2PData(tradeType, amount, paymentMethod, currency) {
  let p2pData = null;

  const API_ENDPOINT =
    'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

  const data = {
    proMerchantAds: false,
    page: 1,
    rows: 20,
    payTypes: [paymentMethod],
    countries: [],
    publisherType: null,
    asset: 'USDT',
    fiat: currency,
    tradeType: tradeType,
    transAmount: amount
  };

  await axios.post(API_ENDPOINT, data).then((response) => {
    p2pData = response.data;
  });

  return p2pData;
}

let port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on ${port}`);
});
