const etherlime = require('etherlime');

const ECTools = require('./../build/ECTools.json');
const TokenContractJson = require('../build/Token.json');
const EscrowContractV2Json = require('../build/Escrow_V2.json');

const deploy = async (network, secret) => {
    const secretLoc = "";
    const dAppAdmin = "0x8E8FD30C784BBb9B80877052AAE4bd9D43BCc032"
    const deployer = new etherlime.InfuraPrivateKeyDeployer(secretLoc, "ropsten", "");
    deployer.defaultOverrides = { gasLimit: 4700000, gasPrice: 9000000000 };

    const tokenContractDeployed = await deployer.deploy(TokenContractJson, {});
    const ecToolContract = await deployer.deploy(ECTools);
    const escrowContractDeployed_V2 = await deployer.deploy(EscrowContractV2Json, {
        ECTools: ecToolContract.contractAddress
    }, tokenContractDeployed.contractAddress, dAppAdmin);
};

module.exports = { deploy };