let util = require('./test/util')
let ethers = require('ethers')

test();

async function test () {
    let privateKey = "21741A775203921E3148271B4FC78B60295825FBB3931509C1EEA6A2CE9BAE8C"
    let provider = ethers.getDefaultProvider();
    let wallet = new ethers.Wallet(privateKey, provider);

    let nonce         = 10;
    let escrowAddress = "0x7B06C67a2f1C446B7B27A1F3B48625FE3Ed65b9C";
    let addressToFund = "0x84e5040b3f758c2fd2b5816f81b52b193242c9e4";
    let tokensToSend  = 10000;
    let weiToSend     = 10000;
    let typesArray = ["uint256", "address", "address", "uint256", "uint256"];

    let signerMessage = await util.getSignedFundMessage(wallet, typesArray, [nonce, escrowAddress, addressToFund, weiToSend, tokensToSend])

    console.log(signerMessage)
};