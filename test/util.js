const ethers = require('ethers');

const util = {
	expectThrow: async (promise, revertMessage = "") => {
		try {
			let result = await promise;
		} catch (error) {
			const revert = error.message.search('revert') >= 0;
			const revertMessageExists = error.message.search(revertMessage) >= 0;
			assert(revert && revertMessageExists, "Expected throw, got '" + error + "' instead")
			return
		}
		assert.fail('Expected throw not received')
	},
	generateRandomNonce: function () {
		const BigNumber = require('bignumber.js').BigNumber;
		const randomNumber = BigNumber.random(77);
		return randomNumber.toString().substring(2, randomNumber.length);
	},
	getSignedFundMessage: async function (wallet, paramTypes, paramValues) {
		const authorizationHash = ethers.utils.solidityKeccak256(paramTypes, paramValues);
		const authorizationHashBytes = ethers.utils.arrayify(authorizationHash);
		const authorizationSignature = await wallet.signMessage(authorizationHashBytes);

		return authorizationSignature;
	},
	getGasCostFromTx: async (tx, provider) => {
		try {
			let result = await tx;
			let txReceipt = await provider.getTransactionReceipt(result.hash);
			return result.gasPrice.mul(txReceipt.gasUsed);
		} catch (error) {
			assert.fail('Transaction reverted')
		}
	}
}


module.exports = util;