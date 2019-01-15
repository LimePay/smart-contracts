const ethers = require('ethers');
const etherlime = require('etherlime');

const utils = require('./util');
const Token = require('./../build/Token.json');
const ECTools = require('./../build/ECTools.json');
const EscrowContract = require('./../build/Escrow_V2.json');

// TODO More tests must be implemented for the full coverage of the functionality and testing corner cases

describe('Escrow Contract', function () {
    this.timeout(5000);
    let signer = accounts[3];
    let nonSigner = accounts[4];

    let dAppAdmin = accounts[5];
    let nonDappAdmin = accounts[6];

    const tokensToSend = ethers.utils.bigNumberify('1000000000'); // 0.000000001 tokens
    const weiToSend = ethers.utils.bigNumberify('1000000000000000000'); // 1 ether
    const gasPrice = 20000000000; // 20 gwei
    const gasLimit = 200000;

    let deployer;
    let recipient;

    let escrowDappAdminExecutor;
    let escrowSignerExecutor;
    let escrowContract;

    async function initEscrowContract() {
        deployer = new etherlime.EtherlimeGanacheDeployer(dAppAdmin.wallet.privateKey);
        deployer.defaultOverrides = {
            gasLimit: 4700000
        }

        tokenContract = await deployer.deploy(Token);

        const ecToolContract = await deployer.deploy(ECTools);

        escrowContract = await deployer.deploy(EscrowContract, { ECTools: ecToolContract.contractAddress }, tokenContract.contractAddress, dAppAdmin.wallet.address);

        dAppAdmin.wallet = dAppAdmin.wallet.connect(deployer.provider);
        signer.wallet = signer.wallet.connect(deployer.provider);

        escrowDappAdminExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, dAppAdmin.wallet);
        escrowSignerExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, signer.wallet);
    }

    async function setupEscrowContract() {
        await deployer.wallet.sendTransaction({
            to: escrowContract.contractAddress,
            value: weiToSend.mul(2)
        });

        await tokenContract.contract.transfer(escrowContract.contractAddress, tokensToSend.mul(2));
    }

    describe('Fund and Refund functionality', () => {

        const addSigner = true;
        let signedFiatPaymentFunds;
        let signedRelayedPaymentFunds;

        const nonce = utils.generateRandomNonce();

        beforeEach(async () => {
            await initEscrowContract();

            await setupEscrowContract();

            await escrowDappAdminExecutor.editSigner(signer.wallet.address, addSigner);

            recipient = ethers.Wallet.createRandom();

            signedFiatPaymentFunds = await utils.getSignedFundMessage(signer.wallet, ['uint256', 'address', 'address', 'uint256', 'uint256'], [nonce, escrowContract.contractAddress, recipient.address, tokensToSend, weiToSend]);
            signedRelayedPaymentFunds = await utils.getSignedFundMessage(signer.wallet, ['uint256', 'address', 'address', 'uint256'], [nonce, escrowContract.contractAddress, recipient.address, weiToSend]);
        });

        it('Should process fiat payment funding correctly', async () => {
            const signerBalanceBeforeFund = await deployer.provider.getBalance(signer.wallet.address);
            const escrowTokenBalanceBeforeFund = await tokenContract.contract.balanceOf(escrowContract.contractAddress);

            let tx = await escrowSignerExecutor.fundForFiatPayment(nonce, recipient.address, tokensToSend, weiToSend, signedFiatPaymentFunds, { gasLimit: gasLimit, gasPrice: gasPrice });

            await validateAfterFund(signerBalanceBeforeFund, tx);

            const escrowTokenBalanceAfterFund = await tokenContract.contract.balanceOf(escrowContract.contractAddress);
            assert(escrowTokenBalanceBeforeFund.sub(tokensToSend).eq(escrowTokenBalanceAfterFund), 'Incorrect token balance remaining in the contract');

            const recipientTokenBalance = await tokenContract.contract.balanceOf(recipient.address);
            assert(recipientTokenBalance.eq(tokensToSend), 'Incorrect token balance remaining in the recipient');
        });

        it('Should process relayed payment funding correctly', async () => {
            const signerBalanceBeforeFund = await deployer.provider.getBalance(signer.wallet.address);

            let tx = await escrowSignerExecutor.fundForRelayedPayment(nonce, recipient.address, weiToSend, signedRelayedPaymentFunds, { gasLimit: gasLimit, gasPrice: gasPrice });

            await validateAfterFund(signerBalanceBeforeFund, tx);
        });

        it('Should process 1000 fiat payments and refund correctly', async () => {
            await tokenContract.contract.transfer(escrowContract.contractAddress, tokensToSend.mul(1010));
            await deployer.wallet.sendTransaction({
                to: escrowContract.contractAddress,
                value: weiToSend.mul(1010)
            });
            
            let signerBalanceBeforeFund = await deployer.provider.getBalance(deployer.wallet.address);
            
            for(i = 0; i < 500; i++){
                nonce = await utils.generateRandomNonce();
                signedFiatPaymentFunds = await utils.getSignedFundMessage(signer.wallet, ['uint256', 'address', 'address', 'uint256', 'uint256'], [nonce, escrowContract.contractAddress, recipient.address, tokensToSend, weiToSend]);
                tx = await escrowDappAdminExecutor.fundForFiatPayment(nonce, recipient.address, tokensToSend, weiToSend, signedFiatPaymentFunds, { gasLimit: gasLimit, gasPrice: gasPrice });
            }

            for(i = 0; i < 500; i++){
                recipient = await ethers.Wallet.createRandom();
                nonce = await utils.generateRandomNonce();
                signedFiatPaymentFunds = await utils.getSignedFundMessage(signer.wallet, ['uint256', 'address', 'address', 'uint256', 'uint256'], [nonce, escrowContract.contractAddress, recipient.address, tokensToSend, weiToSend]);
                tx = await escrowDappAdminExecutor.fundForFiatPayment(nonce, recipient.address, tokensToSend, weiToSend, signedFiatPaymentFunds, { gasLimit: gasLimit, gasPrice: gasPrice });
            }

            let signerBalanceAfterFund = await deployer.provider.getBalance(deployer.wallet.address);

            assert.closeTo(
                250000,
                Number(signerBalanceAfterFund.sub(signerBalanceBeforeFund).div(gasPrice).toString()),
                750000,
                'Incorrect wei balance'
            );
        }).timeout(5000000);


        async function validateAfterFund(signerBalanceBeforeFund, fundTx) {
            const signerBalanceAfterFund = await deployer.provider.getBalance(signer.wallet.address);

            assert(signerBalanceAfterFund.gte(signerBalanceBeforeFund), 'Incorrect signer wei balance');
            assert.closeTo(0, Number(signerBalanceAfterFund.sub(signerBalanceBeforeFund).div(gasPrice).toString()), 3500, 'Refund amount is outside the range');

            const escrowWeiBalance = await deployer.provider.getBalance(escrowContract.contractAddress);

            const txReceipt = await deployer.provider.getTransactionReceipt(fundTx.hash);
            const gasUsed = txReceipt.gasUsed;
            const txGasCost = gasUsed.mul(fundTx.gasPrice);
            const expectedEscrowWeiBalance = weiToSend.sub(txGasCost.toString());

            assert.closeTo(
                0,
                Number(expectedEscrowWeiBalance.sub(escrowWeiBalance).div(gasPrice).toString()),
                3500,
                'Incorrect wei balance remaining in the contract'
            );

            const recipientWeiBalance = await deployer.provider.getBalance(recipient.address);
            assert(recipientWeiBalance.eq(weiToSend), 'Incorrect wei balance remaining in the recipient');
        }

        it('[NEGATIVE] Fund should not be executed if a nonce already exists', async () => {
            await escrowSignerExecutor.fundForFiatPayment(nonce, recipient.address, tokensToSend, weiToSend, signedFiatPaymentFunds, { gasLimit: gasLimit, gasPrice: gasPrice });

            assert(await escrowContract.contract.usedNonces(nonce), 'Nonce is not marked as used');

            await utils.expectThrow(
                escrowSignerExecutor.fundForRelayedPayment(nonce, recipient.address, weiToSend, signedRelayedPaymentFunds, { gasLimit: gasLimit, gasPrice: gasPrice }),
                'Nonce already used'
            );
        });

        it('[NEGATIVE] Fund should not be executed from non-signer address', async () => {
            nonSigner.wallet = nonSigner.wallet.connect(deployer.provider);
            const escrowNonSignerExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, nonSigner.wallet);

            const authorizationFiatFundSignature = await utils.getSignedFundMessage(nonSigner.wallet, ['uint256', 'address', 'address', 'uint256', 'uint256'], [nonce, escrowContract.contractAddress, recipient.address, tokensToSend, weiToSend]);
            const authorizationRelayedFundSignature = await utils.getSignedFundMessage(nonSigner.wallet, ['uint256', 'address', 'address', 'uint256'], [nonce, escrowContract.contractAddress, recipient.address, weiToSend]);

            await utils.expectThrow(
                escrowNonSignerExecutor.fundForFiatPayment(nonce, recipient.address, tokensToSend, weiToSend, authorizationFiatFundSignature,
                    { gasLimit: gasLimit, gasPrice: gasPrice }
                ),
                'Invalid authorization signature or signer'
            );

            await utils.expectThrow(
                escrowNonSignerExecutor.fundForRelayedPayment(nonce, recipient.address, weiToSend, authorizationRelayedFundSignature,
                    { gasLimit: gasLimit, gasPrice: gasPrice }
                ),
                'Invalid authorization signature or signer'
            );
        });

        it('[NEGATIVE] Fund should not be executed if fund and refund sum is bigger than contract balance', async () => {


            await utils.expectThrow(
                escrowSignerExecutor.fundForFiatPayment(nonce, recipient.address, tokensToSend, weiToSend.mul(3), signedFiatPaymentFunds, { gasLimit: gasLimit, gasPrice: gasPrice }),
            );
        });
    });

    describe('Fund without funds', () => {
        const addSigner = true;
        let signedFiatPaymentFunds;
        let nonce = utils.generateRandomNonce();

        beforeEach(async () => {
            await initEscrowContract();
            await escrowDappAdminExecutor.editSigner(signer.wallet.address, addSigner);
            recipient = ethers.Wallet.createRandom();
            signedFiatPaymentFunds = await utils.getSignedFundMessage(signer.wallet, ['uint256', 'address', 'address', 'uint256', 'uint256'], [nonce, escrowContract.contractAddress, recipient.address, tokensToSend, weiToSend]);
        });

        it('[NEGATIVE] Shouldn\'t fund with tokens and without ethers', async () => {
            await tokenContract.contract.transfer(escrowContract.contractAddress, tokensToSend.mul(2));

            await utils.expectThrow(
                escrowSignerExecutor.fundForFiatPayment(nonce, recipient.address, tokensToSend, weiToSend, signedFiatPaymentFunds, { gasLimit: gasLimit, gasPrice: gasPrice }),
                'revert'
            );
        });

        it('[NEGATIVE] Shouldn\'t fund with ethers and without tokens', async () => {
            await deployer.wallet.sendTransaction({
                to: escrowContract.contractAddress,
                value: weiToSend.mul(2)
            });

            await utils.expectThrow(
                escrowSignerExecutor.fundForFiatPayment(nonce, recipient.address, tokensToSend, weiToSend, signedFiatPaymentFunds, { gasLimit: gasLimit, gasPrice: gasPrice }),
                'revert'
            );
        });
    });

    describe('Signer functionality', () => {

        const addSigner = true;
        const removeSigner = false;

        let newSigner;

        beforeEach(async () => {
            await initEscrowContract();

            newSigner = ethers.Wallet.createRandom();
            newSigner = newSigner.connect(deployer.provider);

            nonDappAdmin.wallet = nonDappAdmin.wallet.connect(deployer.provider);
        });


        it('dAppAdmin should be able to make other addresses signers', async () => {
            await escrowDappAdminExecutor.editSigner(newSigner.address, addSigner, { gasLimit: gasLimit });
            assert(await escrowDappAdminExecutor.signers(newSigner.address), 'New signer is not added');
        });

        it('dAppAdmin should be able to remove signer privilege from other addresses', async () => {
            await escrowDappAdminExecutor.editSigner(newSigner.address, addSigner, { gasLimit: gasLimit });
            assert(await escrowDappAdminExecutor.signers(newSigner.address), 'New signer is not added');

            await escrowDappAdminExecutor.editSigner(newSigner.address, removeSigner, { gasLimit: gasLimit });
            assert(!await escrowDappAdminExecutor.signers(newSigner.address), 'Added signer has not been removed');
        });

        it('Should get signer address from valid signed message ', async () => {
            const authorizationHash = ethers.utils.solidityKeccak256(['uint256'], [10]);
            const authorizationHashBytes = ethers.utils.arrayify(authorizationHash);
            const authorizationSignature = await signer.wallet.signMessage(authorizationHashBytes);

            const messageSigner = await escrowContract.contract.getSigner(authorizationHash, authorizationSignature);
            assert(messageSigner == signer.wallet.address, 'Invalid signer');
        });

        it('[NEGATIVE] Non-dAppAdmin address should not be able to add or remove another signers privilege', async () => {
            const escrowNonDappAdminExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, nonDappAdmin.wallet);

            await utils.expectThrow(
                escrowNonDappAdminExecutor.editSigner(newSigner.address, addSigner, { gasLimit: gasLimit }),
                'Unauthorized access'
            );

            await utils.expectThrow(
                escrowNonDappAdminExecutor.editSigner(newSigner.address, removeSigner, { gasLimit: gasLimit }),
                'Unauthorized access'
            );
        });
    });

    describe('Withdrawal functionality', () => {

        beforeEach(async () => {
            await initEscrowContract();
            await setupEscrowContract();

            recipient = ethers.Wallet.createRandom();
            nonSigner.wallet = nonSigner.wallet.connect(deployer.provider);
        });

        it('dAppAdmin should be able to withdraw ethers', async () => {
            const dAppAdminBalanceBeforeWithdraw = await deployer.provider.getBalance(dAppAdmin.wallet.address);
            let gasCost = await utils.getGasCostFromTx(escrowDappAdminExecutor.withdrawEthers(weiToSend, { gasLimit: gasLimit }), deployer.provider);
            const dAppAdminBalanceAfterWithdraw = await deployer.provider.getBalance(dAppAdmin.wallet.address);

            assert(dAppAdminBalanceAfterWithdraw.eq(dAppAdminBalanceBeforeWithdraw.add(weiToSend).sub(gasCost)), 'Incorrect withdrawn ethers amount');
        });

        it('dAppAdmin should be able to withdraw tokens', async () => {
            const dAppAdminBalanceBeforeWithdraw = await tokenContract.contract.balanceOf(dAppAdmin.wallet.address);
            await escrowDappAdminExecutor.withdrawTokens(tokensToSend, { gasLimit: gasLimit });
            const dAppAdminBalanceAfterWithdraw = await tokenContract.contract.balanceOf(dAppAdmin.wallet.address);

            assert(dAppAdminBalanceBeforeWithdraw.add(tokensToSend).eq(dAppAdminBalanceAfterWithdraw), 'Incorrect withdrawn tokens amount');
        }).timeout(75000);

        it('[NEGATIVE] Non-dAppAdmin should not be able to withdraw ethers', async () => {
            const escrowNonDappAdminExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, nonDappAdmin.wallet);

            await utils.expectThrow(
                escrowNonDappAdminExecutor.withdrawEthers(weiToSend, { gasLimit: gasLimit }),
                'Unauthorized access'
            );
        });

        it('[NEGATIVE] Non-dAppAdmin should not be able to withdraw tokens', async () => {
            const escrowNonDappAdminExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, nonDappAdmin.wallet);

            await utils.expectThrow(
                escrowNonDappAdminExecutor.withdrawTokens(tokensToSend, { gasLimit: gasLimit }),
                'Unauthorized access'
            );
        });

        it('[NEGATIVE] dAppAdmin should not be able to withdraw more ethers than the contract balance', async () => {
            await utils.expectThrow(
                escrowDappAdminExecutor.withdrawEthers(weiToSend.mul(3), { gasLimit: gasLimit })
            );
        });

        it('[NEGATIVE] dAppAdmin should not be able to withdraw more tokens than the contract balance', async () => {
            await utils.expectThrow(
                escrowDappAdminExecutor.withdrawTokens(tokensToSend.mul(3), { gasLimit: gasLimit })
            );
        });
    });

    describe('DAppAdmin functionality', () => {

        beforeEach(async () => {
            await initEscrowContract();

            newDAppAdmin = ethers.Wallet.createRandom();
            nonSigner.wallet = nonSigner.wallet.connect(deployer.provider);
        });

        it('Only dAppAdmin should be able to set a new dAppAdmin', async () => {
            await escrowDappAdminExecutor.editDappAdmin(newDAppAdmin.address);

            let newDAppAdminAddress = await escrowDappAdminExecutor.dAppAdmin()

            assert(newDAppAdmin.address == newDAppAdminAddress, "dApp admin hasn't been changed")
        });

        it('Non dAppAdmin shouldn\'t be able to set a new dAppAdmin', async () => {
            await utils.expectThrow(
                escrowSignerExecutor.editDappAdmin(newDAppAdmin.address)
            );
        });
    });
});