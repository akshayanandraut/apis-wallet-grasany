var admin = require("firebase-admin");
var express = require('express');
const bodyParser = require('body-parser')
var app = express();
var fs = require("fs");
var walletsRef = null;
var transactionsRef = null;
var serviceAccount = require("./grasany-wallet-firebase-adminsdk-ll0m3-c379904c1e");
const jwt = require('express-jwt');
const jwksRsa = require('jwks-rsa');
var UniqueTransactionId = require('uniqid');
const PORT = process.env.PORT || 8081;

const log = require('pino')();

const checkJwt = jwt({
    secret: jwksRsa.expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://akshayanandraut.auth0.com/.well-known/jwks.json`
    }),

    // Validate the audience and the issuer.
    audience: 'https://akshayanandraut.auth0.com/api/v2/',
    issuer: `https://akshayanandraut.auth0.com/`,
    algorithms: ['RS256']
});

app.use(checkJwt);
app.use((err, req, res, next) => {
    log.error(err);
    res.status(err.status).json(err);

});

app.get("/", (req, res) => {
    var uptime = process.uptime();
    var startedAt = Date.now() - uptime.toFixed(0) * 1000;
    res.json({
        "status": "UP",
        "uptimeInMilliseconds": uptime * 1000,
        "uptimeInSeconds": uptime,
        "uptimeInMinutes": uptime / 60,
        "uptimeInHours": uptime / 360,
        "uptimeInDays": uptime / 86400,
        "appStartedOn": new Date(startedAt).toString()

    });
});

app.get("/wallet/:walletId", (req, res) => {
    //user1walletid
    walletsRef.ref.child(req.params.walletId).on("value", function (snapshot) {
        var wallet = snapshot.val()
        log.info(wallet);
        res.json(wallet ? wallet : {"wallet_id": "null"});
    });
});
app.get('*', function (req, res) {
    res.json({"errorCode": 404, "errorDesc": "Invalid route in request"});
});

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://grasany-wallet.firebaseio.com"
});

var jsonParser = bodyParser.json();
var urlencodedParser = bodyParser.urlencoded({extended: false});

app.post("/wallet/details", jsonParser, (req, res) => {
    var body = req.body;
    try {
        walletsRef.child(body.walletId).once('value').then(function (snapshot) {
            res.json(snapshot.val());
        }, function (error) {
            console.error(error);
            res.json(error.toString());
        });
    } catch (e) {
        res.json({"error": "An error occurred when fetching the wallet. Probably the walledId attribute is missing"});
    }
});

app.post("/wallet/transactions", jsonParser, (req, res) => {
    var body = req.body;
    try {
        transactionsRef.once("value").then(function (snapshot) {

                snapshot.forEach(function(data) {
                    var transaction = data.val();
                    if (!transaction.val().comments.contains("Error [ERR_HTTP_HEADERS_SENT]")) {
                        console.log(transaction);
                    }
                });


                res.json(snapshot.val());
            }
            ,

            function (error) {
                console.error(error);
                res.json(error.toString());
            }
        ).catch(reason => {
            console.log(reason)
        });
    } catch
        (e) {
        res.json({"error": "An error occurred when fetching the transactions from the database. Check your input wallet first"});
    }
})
;


app.post("/wallet/credit", jsonParser, (req, res) => {
    var body = req.body;
    var currentTransactionRef = UniqueTransactionId("TRN-C").toUpperCase();
    var wallet = null;

    if (body.amount < 1) {
        res.json({"error": "Amount can't be less than (the minimum) 1"});
        return;
    }

    walletsRef.child(body.walletId).once('value').then(function (snapshot) {
        addTransaction("credit", body, currentTransactionRef)
        wallet = snapshot.val();
        updateWalletBalance(body.walletId, wallet.balance, body.amount, currentTransactionRef);
        wallet.balance = wallet.balance ? wallet.balance : 0 + body.amount;
    }, function (error) {
        console.error(error);
        res.send(error);
    }).then(() => {
        setTimeout(() => {
            walletsRef.child(body.walletId).once('value').then(function (snapshot1) {
                try {
                    res.send(snapshot1.val());
                    markTransaction(currentTransactionRef, "success", "");

                } catch (e) {
                    // console.log("Error: probably due to invalid amount\n" + e);
                    markTransaction(currentTransactionRef, "success", e.toString());

                }
            });
        }, 5000);

    });
    ;
});


app.post("/wallet/debit", jsonParser, (req, res) => {
    var body = req.body;
    var currentTransactionRef = UniqueTransactionId("TRN-D").toUpperCase();
    var wallet = null;

    if (body.amount < 1) {
        res.json({"error": "Amount can't be less than (the minimum) 1"});
        return;
    }

    walletsRef.child(body.walletId).once('value').then(function (snapshot) {
        addTransaction("debit", body, currentTransactionRef)
        wallet = snapshot.val();
        if ((wallet.balance - body.amount) >= 0) {
            updateWalletBalance(body.walletId, wallet.balance, -body.amount, currentTransactionRef)
        } else {
            res.json({"error": "Insufficient balance"});
            return;
        }
    }, function (error) {
        console.error(error);
        res.send(error);
    }).then(() => {
        setTimeout(() => {
            walletsRef.child(body.walletId).once('value').then(function (snapshot1) {
                try {
                    res.send(snapshot1.val());
                    markTransaction(currentTransactionRef, "success", "");
                } catch (e) {
                    // console.log("Error: probably due to insufficent balance\n" + e);
                    markTransaction(currentTransactionRef, "failed", e.toString());
                }
            }, function (err) {
                console.log(err);
            });
        }, 5000);

    });
});

function markTransaction(currentTransactionRef, status, comments) {
    transactionsRef.child(currentTransactionRef).update(
        {
            endTime: Date.now(),
            status: status,
            comments: comments
        }
    );
}


function updateWalletBalance(walletId, walletBalance, transactionAmount, currentTransactionRef) {
    walletsRef.child(walletId).update(
        {
            balance: walletBalance + transactionAmount,
            lastTransaction: currentTransactionRef
        }
    );
}

function addTransaction(type, body, currentTransactionRef) {
    transactionsRef.child(currentTransactionRef).set({
        "walletId": body.walletId,
        "amount": body.amount,
        "type": type,
        "currency": "INR",//setting deault
        "description": body.transactionDescription.substring(0, 50),
        "requestTimestamp": body.transactionRequestTimestamp,
        "timestamp": Date.now()
    });
}

app.post("/wallet/createNew", jsonParser, (req, res) => {

    var body = req.body;
    console.log(body);

    res.json([{"response": "Create new Wallet"}]);
});


function config() {
    log.info("setting up firebase config...");
    var db = admin.database();
    var ref = db.ref("/");
    log.info("setting up firebase config...DONE");
    walletsRef = ref.child("wallets");
    transactionsRef = ref.child("transactions");
    log.info("Wallets and Transactions initialized");
}

var server = app.listen(PORT, () => {
    config();
    log.info("Server running on port {}",PORT);
});

