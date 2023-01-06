const express = require('express');
const bodyParser = require('body-parser');
const ejs = require('ejs');
const axios = require('axios');

const app = express();
app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/get-results', async (req, res) => {
  let exchangeData = null;
  let buyAmount = req.query.buyAmount;
  let buyCurrency = req.query.buyCurrency;
  let sellCurrency = req.query.sellCurrency;

  await axios
    .get('https://api.exchangerate.host/convert?from=GBP&to=PKR')
    .then((response) => {
      exchangeData = response.data;
    });

  let fiatTotalAmount = Math.round(buyAmount * exchangeData.info.rate);

  let p2pBuyData = await fetchP2PData('BUY', buyAmount, 'Wise', buyCurrency);
  let p2pBuyAdv = p2pBuyData.data[0];

  let boughtUSDT = buyAmount / p2pBuyAdv.adv.price;

  let p2pSellData = await fetchP2PData(
    'SELL',
    fiatTotalAmount,
    'BANK',
    sellCurrency
  );

  let p2pSellAdv = null;
  p2pSellData.data.every((ad) => {
    if (
      ad.adv.minSingleTransQuantity < boughtUSDT &&
      boughtUSDT < ad.adv.maxSingleTransQuantity
    ) {
      p2pSellAdv = ad;
      return false;
    }
  });

  let soldCurrencyAmount = boughtUSDT * p2pSellAdv.adv.price;

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

async function fetchP2PData(tradeType, amount, paymentMethod, currency) {
  let p2pData = null;

  const API_ENDPOINT =
    'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

  const data = {
    proMerchantAds: false,
    page: 1,
    rows: 10,
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
