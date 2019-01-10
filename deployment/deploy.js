const etherlime = require('etherlime');

const ECTools = require('./../build/ECTools.json');
const TokenContractJson = require('../build/Token.json');
const EscrowContractV2Json = require('../build/Escrow_V2.json');

const deploy = async (network, secret) => {
    const secretLoc = "";
    const deployer = new etherlime.EtherlimeGanacheDeployer('0x7ab741b57e8d94dd7e1a29055646bafde7010f38a900f55bbd7647880faa6ee8', 8545);
    // const deployer = new etherlime.InfuraPrivateKeyDeployer(secretLoc, "ropsten", "Up5uvBHSCSqtOmnlhL87");
    deployer.defaultOverrides = { gasLimit: 4700000, gasPrice: 9000000000 };

    const tokenContractDeployed = await deployer.deploy(TokenContractJson, {});
    const ecToolContract = await deployer.deploy(ECTools);
    const escrowContractDeployed_V2 = await deployer.deploy(EscrowContractV2Json, {
        ECTools: ecToolContract.contractAddress
    }, tokenContractDeployed.contractAddress, tokenContractDeployed.contractAddress);
};

module.exports = { deploy };