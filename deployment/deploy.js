const etherlime = require('etherlime');

const ECTools = require('./../build/ECTools.json');
const TokenContractJson = require('../build/Mock_Token.json');
const EscrowContractV2Json = require('../build/Escrow_V2.json');

const deploy = async (network, secret) => {
    const PRIVATE_KEY = "";
    const DAPP_ADMIN = "0x8E8FD30C784BBb9B80877052AAE4bd9D43BCc032";

    const deployer = new etherlime.InfuraPrivateKeyDeployer(PRIVATE_KEY, "ropsten", "");
    deployer.defaultOverrides = { gasLimit: 4700000, gasPrice: 3000000000 };

    const tokenContractDeployed = await deployer.deploy(TokenContractJson, {});
    const ecToolContract = await deployer.deploy(ECTools);
    const escrowContractDeployed_V2 = await deployer.deploy(EscrowContractV2Json, {
        ECTools: ecToolContract.contractAddress
    }, tokenContractDeployed.contractAddress, DAPP_ADMIN);
};

module.exports = { deploy };