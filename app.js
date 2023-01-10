require('dotenv').config();
const nodeEnv = process.env.NODE_ENV;
const testMode = nodeEnv === "TEST";
const express = require('express');
const bodyParser = require('body-parser');
const ejs = require('ejs');
const axios = require('axios');
const https = require('https');

const app = express();
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({extended: true}));

/**
 * Disable HTTPS/SSL requirement in development mode / company intranet environments where certificates pose an issue
 * and throw UNABLE_TO_GET_ISSUER_CERT_LOCALLY exceptions
 */
if (testMode) {
    axios.defaults.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
    });
    // eslint-disable-next-line no-console
    console.log(nodeEnv, `RejectUnauthorized is disabled.`)
}

const defaultOpts = {
    error: null,
    asset: process.env.DEFAULT_ASSET || 'USDT',
    buyCurrency: process.env.DEFAULT_BUY_CURRENCY || 'GBP',
    buyAmount: process.env.DEFAULT_BUY_AMOUNT || 150,
    sellCurrency: process.env.DEFAULT_SELL_CURRENCY || 'PKR'
}

// Render the app index page
app.get('/', (req, res) => {
    res.render('index', defaultOpts);
});

// Calculate the data and return the data in JSON
app.get('/get-results', async (req, res) => {
    let exchangeData = null;
    let asset = req.query.asset;
    let buyAmount = req.query.buyAmount;
    let buyCurrency = req.query.buyCurrency;
    let sellCurrency = req.query.sellCurrency;
    let apiError = null;
    console.log("get-results: Buy " + asset + " worth " + buyAmount + " " + buyCurrency);

    // Fetch the fiat exchange data from the API using the buyCurrency & sellCurrency
    await axios
        .get(
            `https://api.exchangerate.host/convert?from=${buyCurrency}&to=${sellCurrency}`
        )
        .then((response) => {
            exchangeData = response.data;
        })
        .catch(function (error) {
            console.log("Error getting exchange rate. ErrorCode: " + error.cause.code  + ", ErrorMessage: " + error.cause.message);
            //console.log(error);
            apiError = prepareError(error);
        });

    if (apiError != null) {
        return sendErrorResponse(req, res, apiError.fullOutput);
    }

    if (exchangeData == null) {
        return sendErrorResponse(req, res, "No exchange data found.");
    }

    // Calculate the fiat exchange total amount of the buyAmount
    let fiatRate = exchangeData.info.rate;
    let fiatTotalAmount = Math.round(buyAmount * fiatRate);

    // Fetch buyCurrency P2P data using Wise payment method & buyAmount
    let p2pBuyData = await fetchP2PData('BUY', buyAmount, 'Wise', buyCurrency, asset);

    if (p2pBuyData.errorCode) {
        return sendErrorResponse(req, res, "Unable to get purchase details: [" + p2pBuyData.errorCode + "] " + p2pBuyData.errorMessage);
    }

    // Select the first advertisement given it matches with our requirements
    // Also since this would be the best price as well
    let p2pBuyAdv = p2pBuyData.data[0];

    if (p2pBuyAdv == null) {
        return sendErrorResponse(req, res, "No buy advert found.");
    }

    // Calculate the boughtAssetAmount using the above advertisement price
    // console.log(p2pBuyAdv);
    let boughtAssetAmount = buyAmount / p2pBuyAdv.adv.price;

    // Now fetch the sellCurrency P2P data using Bank Transfer payment method & fiatTotalAmount
    let p2pSellData = await fetchP2PData(
        'SELL',
        fiatTotalAmount,
        'BANK',
        sellCurrency,
        asset
    );

    if (p2pSellData.errorCode) {
        return sendErrorResponse(req, res, "Unable to get sale details: [" + p2pSellData.errorCode + "] " + p2pSellData.errorMessage);
    }

    // Now you need to look for the one ad where you can sell the asset looking at the limits set by advertisers
    // Once a suitable advertisement has been located then stop looking for more and use that one
    let p2pSellAdv = null;

    for (let i = 0; i < p2pSellData.data.length; i++) {
        let ad = p2pSellData.data[i];
        if (
            ad.adv.minSingleTransQuantity < boughtAssetAmount &&
            boughtAssetAmount < ad.adv.maxSingleTransQuantity
        ) {
            p2pSellAdv = ad;
            break;
        }
    }

    if (p2pSellAdv == null) {
        return sendErrorResponse(req, res, "No sell advert found.");
    }

    // Now calculate the final soldCurrencyAmount using the above selected advertisement price for selling
    // console.log(p2pSellAdv);
    let soldCurrencyAmount = boughtAssetAmount * p2pSellAdv.adv.price;
    let profit = currencyFormat(soldCurrencyAmount - fiatTotalAmount);

    // Return the data to be rendered on the frontend
    res.json({
        asset: asset,
        buyPrice: p2pBuyAdv.adv.price,
        buyAssetLimit: currencyFormat(p2pBuyAdv.adv.surplusAmount),
        boughtAssetAmount: currencyFormat(boughtAssetAmount),
        buyAdvId: p2pBuyAdv.advertiser.userNo,
        buyAdvertiser: p2pBuyAdv.advertiser.nickName,
        sellPrice: p2pSellAdv.adv.price,
        sellAssetLimit: currencyFormat(p2pSellAdv.adv.surplusAmount),
        soldCurrencyAmount: currencyFormat(soldCurrencyAmount),
        sellAdvId: p2pSellAdv.advertiser.userNo,
        sellAdvertiser: p2pSellAdv.advertiser.nickName,
        fiatRate: currencyFormat(fiatRate),
        fiatTotalAmount: currencyFormat(fiatTotalAmount),
        profit: currencyFormat(profit),
        exchangeSummary: "Exchange: " + buyAmount + " " + buyCurrency + " exchanges to " + currencyFormat(fiatTotalAmount) + " " + sellCurrency + " at a rate of " + currencyFormat(fiatRate) + " " + sellCurrency + ".",
        buySummary: "Bought " + currencyFormat(boughtAssetAmount) + " " + asset + " with " + buyAmount + " " + buyCurrency + ".",
        sellSummary: "Sold " + currencyFormat(boughtAssetAmount) + " " + asset + " for " + currencyFormat(soldCurrencyAmount) + " " + sellCurrency + ".",
        profitSummary: "Profit: " + currencyFormat(profit) + " " + sellCurrency + "."
    });
});

/**
 * @param {number} amount
 * @returns {number}
 */
function currencyFormat(amount) {
    return Math.round(amount * 100) / 100;
}

/**
 * Fetches P2P data from Binance API using the given params
 * @param {*} tradeType
 * @param {*} amount
 * @param {*} paymentMethod
 * @param {*} currency
 * @param {*} asset
 * @returns
 */
async function fetchP2PData(tradeType, amount, paymentMethod, currency, asset) {
    let p2pData = null;
    const API_ENDPOINT = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
    const data = {
        proMerchantAds: false,
        page: 1,
        rows: 20,
        payTypes: [paymentMethod],
        countries: [],
        publisherType: null,
        asset: asset,
        fiat: currency,
        tradeType: tradeType,
        transAmount: amount
    };

    await axios.post(API_ENDPOINT, data)
        .then((response) => {
            p2pData = response.data;
            // console.log(p2pData);
        })
        .catch(function (error) {
            // console.log(error);
            console.log("ErrorCode: " + error.code  + ", ErrorMessage: " + error.message);
            p2pData = prepareError(error);
        });

    return p2pData;
}

/**
 * @param {*} error The error object
 * @returns {{}} A standardised error object, containing the following keys:prepareError(error)
 * <ul>
 * <li>hasError - bool - TRUE if error details exist</li>
 * <li>errorCode - string - The error code</li>
 * <li>errorMessage - string - The error message</li>
 * <li>binanceCode - string - The binance P2P API response code</li>
 * <li>binanceMessage - string - The binance P2P API response message</li>
 * <li>compactOutput - string - Concatenated output containing the errorCode and errorMessage</li>
 * <li>fullOutput - string - Concatenated output containing the binance code/message in addition to the compactOutput</li>
 * </ul>
 */
function prepareError(error) {
    let response = {};

    if (error.code) {
        response.errorCode = error.code;
    }

    if (error.message) {
        response.errorMessage = error.message;
    }

    if (error.cause) {
        if (error.cause.code) {
            response.errorCode = error.cause.code;
        }

        if (error.cause.message) {
            response.errorMessage = error.cause.message;
        }
    }

    if (error.response && error.response.data) {
        if (error.response.data.code) {
            response.binanceCode = error.response.data.code;
        }

        if (error.response.data.message) {
            response.binanceMessage = error.response.data.message;
        }
    }

    let compactOutput = response.errorCode ? "[" + response.errorCode + "] " : "";
    compactOutput += response.errorMessage ? response.errorMessage : "";
    let fullOutput = compactOutput;
    fullOutput += response.binanceCode ? " - Binance: [" + response.binanceCode + "] " : "";
    fullOutput += response.binanceMessage ? response.binanceMessage : "";
    response.compactOutput = compactOutput;
    response.fullOutput = fullOutput;
    response.hasError = response.errorCode || response.errorMessage;

    return response;
}

/**
 * Send an error response
 * @param {Request} req The request object
 * @param {Response} res The response object
 * @param {{}} error The error object
 */
function sendErrorResponse(req, res, error) {
    res.json({
        error: error
    });
}

let port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server started on ${port}`);
});
