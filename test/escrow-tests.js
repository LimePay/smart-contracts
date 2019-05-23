const ethers = require('ethers');
const etherlime = require('etherlime');

const utils = require('./util');
const Token = require('./../build/Mock_Token.json');
const ECTools = require('./../build/ECTools.json');
const EscrowContract = require('./../build/Escrow_V3.json');

const GAS_PRICE = 20000000000; // 20 gwei
const GAS_LIMIT = 200000;

const EXCESS_GAS_REFUND_UPPER_LIMIT = 3500; // The upper limit of exceeding gas that can be refunded and we will count the refund successfull
const NUMBER_OF_TRANSACTIONS = 100; // Number of transactions that will be perfomed for the refund test

let deployer;
let provider;
let escrowContract;
let tokenContract;

describe('Escrow Contract', function () {
    this.timeout(5000);
    let dAppSigner = accounts[3].signer;
    let nonSigner = accounts[4];

    let dAppAdmin = accounts[5];
    let nonDappAdmin = accounts[6];

    let dAppFundExecutor = accounts[7].signer;
    let nonDappFundExecutor = accounts[8];

    const tokensToSend = ethers.utils.bigNumberify('1000000000'); // 0.000000001 tokens
    const weiToSend = ethers.utils.bigNumberify('1000000000000000000'); // 1 ether

    let recipient;

    let escrowDappAdminExecutor;
    let escrowSignerExecutor;
    let escrowFundExecutor;

    async function initEscrowContract() {
        const ecToolContract = await deployRelatedContracts();
        escrowContract = await deployer.deploy(EscrowContract, { ECTools: ecToolContract.contractAddress }, tokenContract.contractAddress, dAppAdmin.signer.address, [dAppFundExecutor.address]);
        provider = deployer.provider;

        dAppAdmin.signer = dAppAdmin.signer.connect(provider);
        dAppSigner = dAppSigner.connect(provider);

        escrowDappAdminExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, dAppAdmin.signer);
        escrowSignerExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, dAppSigner);
        escrowFundExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, dAppFundExecutor);

    }

    async function setupEscrowContract() {
        await deployer.signer.sendTransaction({
            to: escrowContract.contractAddress,
            value: weiToSend.mul(2)
        });

        await tokenContract.contract.transfer(escrowContract.contractAddress, tokensToSend.mul(2));
    }

    describe('Fund and Refund functionality', () => {

        const addSigner = true;
        let signedFiatPaymentFunds;
        let signedRelayedPaymentFunds;

        let nonce = utils.generateRandomNonce();

        beforeEach(async () => {
            await initEscrowContract();

            await setupEscrowContract();

            await escrowDappAdminExecutor.editSigner(dAppSigner.address, addSigner);

            recipient = ethers.Wallet.createRandom();

            signedFiatPaymentFunds = await utils.getSignedFundMessage(dAppSigner, ['uint256', 'address', 'uint256', 'address', 'uint256', 'uint256'], [nonce, escrowContract.contractAddress, GAS_PRICE, recipient.address, weiToSend, tokensToSend]);
            signedRelayedPaymentFunds = await utils.getSignedFundMessage(dAppSigner, ['uint256', 'address', 'uint256', 'address', 'uint256'], [nonce, escrowContract.contractAddress, GAS_PRICE, recipient.address, weiToSend]);
        });

        it('Should process fiat payment funding correctly', async () => {
            const signerBalanceBeforeFund = await provider.getBalance(dAppSigner.address);
            const escrowTokenBalanceBeforeFund = await tokenContract.contract.balanceOf(escrowContract.contractAddress);

            let tx = await escrowFundExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend, tokensToSend, signedFiatPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE });
            // let tx = await escrowSignerExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend, tokensToSend, signedFiatPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE });

            await validateAfterFund(signerBalanceBeforeFund, tx);

            const escrowTokenBalanceAfterFund = await tokenContract.contract.balanceOf(escrowContract.contractAddress);
            assert(escrowTokenBalanceBeforeFund.sub(tokensToSend).eq(escrowTokenBalanceAfterFund), 'Incorrect token balance remaining in the contract');

            const recipientTokenBalance = await tokenContract.contract.balanceOf(recipient.address);
            assert(recipientTokenBalance.eq(tokensToSend), 'Incorrect token balance remaining in the recipient');
        });

        it('Should process relayed payment funding correctly', async () => {
            const msgSenderBalanceBeforeFund = await provider.getBalance(dAppSigner.address);

            let tx = await escrowFundExecutor.fundForRelayedPayment(nonce, GAS_PRICE, recipient.address, weiToSend, signedRelayedPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE });
            // let tx = await escrowSignerExecutor.fundForRelayedPayment(nonce, GAS_PRICE, recipient.address, weiToSend, signedRelayedPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE });

            await validateAfterFund(msgSenderBalanceBeforeFund, tx);
        });

        it('Should process 500 fiat payments and refund correctly', async () => {
            await tokenContract.contract.transfer(escrowContract.contractAddress, tokensToSend.mul(1010));
            await deployer.signer.sendTransaction({
                to: escrowContract.contractAddress,
                value: weiToSend.mul(1010)
            });

            let senderBalanceBeforeFund = await provider.getBalance(deployer.signer.address);

            for (i = 0; i < NUMBER_OF_TRANSACTIONS; i++) {
                recipient = await ethers.Wallet.createRandom();
                nonce = await utils.generateRandomNonce();
                signedFiatPaymentFunds = await utils.getSignedFundMessage(dAppSigner, ['uint256', 'address', 'uint256', 'address', 'uint256', 'uint256'], [nonce, escrowContract.contractAddress, GAS_PRICE, recipient.address, weiToSend, tokensToSend]);
                tx = await escrowFundExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend, tokensToSend, signedFiatPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE });
            }

            let senderBalanceAfterFund = await provider.getBalance(deployer.signer.address);
            const excessGasRefunded = Number(senderBalanceAfterFund.sub(senderBalanceBeforeFund).div(GAS_PRICE).toString());

            assert.closeTo(0, excessGasRefunded, NUMBER_OF_TRANSACTIONS * EXCESS_GAS_REFUND_UPPER_LIMIT, 'Incorrect wei balance');
        }).timeout(5000000);

        it('Should process 500 relayed payments and refund correctly', async () => {
            await tokenContract.contract.transfer(escrowContract.contractAddress, tokensToSend.mul(1010));
            await deployer.signer.sendTransaction({
                to: escrowContract.contractAddress,
                value: weiToSend.mul(1010)
            });

            const senderBalanceBeforeFund = await provider.getBalance(deployer.signer.address);

            const transactions = [];
            for (i = 0; i < NUMBER_OF_TRANSACTIONS; i++) {
                recipient = await ethers.Wallet.createRandom();
                let currentNonce = await utils.generateRandomNonce();

                let signedFiatPaymentFunds = await utils.getSignedFundMessage(
                    dAppSigner,
                    ['uint256', 'address', 'uint256', 'address', 'uint256'],
                    [currentNonce, escrowContract.contractAddress, GAS_PRICE, recipient.address, weiToSend]);

                tx = await escrowFundExecutor.fundForRelayedPayment(currentNonce, GAS_PRICE, recipient.address, weiToSend, signedFiatPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE });
                const result = await tx.wait();
                transactions.push(result);
            }

            const senderBalanceAfterFund = await provider.getBalance(deployer.signer.address);
            assert(senderBalanceAfterFund.gte(senderBalanceBeforeFund), 'Incorrect sender wei balance');

            const excessGasRefunded = Number(senderBalanceAfterFund.sub(senderBalanceBeforeFund).div(GAS_PRICE).toString());
            assert.closeTo(0, excessGasRefunded, NUMBER_OF_TRANSACTIONS * EXCESS_GAS_REFUND_UPPER_LIMIT, 'Incorrect wei balance');

        }).timeout(5000000);

        async function validateAfterFund(signerBalanceBeforeFund, fundTx) {
            const msgSenderBalanceAfterFund = await provider.getBalance(dAppSigner.address);

            assert(msgSenderBalanceAfterFund.gte(signerBalanceBeforeFund), 'Incorrect sender wei balance');
            assert.closeTo(0, Number(msgSenderBalanceAfterFund.sub(signerBalanceBeforeFund).div(GAS_PRICE).toString()), EXCESS_GAS_REFUND_UPPER_LIMIT, 'Refund amount is outside the range');

            const txReceipt = await provider.getTransactionReceipt(fundTx.hash);
            await verifyContractBalanceAfterRefund(txReceipt.gasUsed, weiToSend);

            const recipientWeiBalance = await provider.getBalance(recipient.address);
            assert(recipientWeiBalance.eq(weiToSend), 'Incorrect wei balance remaining in the recipient');
        }

        it('[NEGATIVE] Fund should not be executed if a nonce already exists', async () => {
            await escrowFundExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend, tokensToSend, signedFiatPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE });
            // await escrowSignerExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend, tokensToSend, signedFiatPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE });

            assert(await escrowContract.contract.usedNonces(nonce), 'Nonce is not marked as used');

            await utils.expectThrow(
                escrowFundExecutor.fundForRelayedPayment(nonce, GAS_PRICE, recipient.address, weiToSend, signedRelayedPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE }),
                // escrowSignerExecutor.fundForRelayedPayment(nonce, GAS_PRICE, recipient.address, weiToSend, signedRelayedPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE }),
                'Nonce already used'
            );
        });

        it('[NEGATIVE] Fund should not be executed when non-signer sign the fund data', async () => {
            nonSigner.signer = nonSigner.signer.connect(provider);

            const authorizationFiatFundSignature = await utils.getSignedFundMessage(nonSigner.signer, ['uint256', 'address', 'uint256', 'address', 'uint256', 'uint256'], [nonce, escrowContract.contractAddress, GAS_PRICE, recipient.address, weiToSend, tokensToSend]);
            const authorizationRelayedFundSignature = await utils.getSignedFundMessage(nonSigner.signer, ['uint256', 'address', 'uint256', 'address', 'uint256'], [nonce, escrowContract.contractAddress, GAS_PRICE, recipient.address, weiToSend]);

            await utils.expectThrow(
                escrowFundExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend, tokensToSend, authorizationFiatFundSignature,
                    { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE }
                ),
                'Invalid authorization signature or signer'
            );

            await utils.expectThrow(
                escrowFundExecutor.fundForRelayedPayment(nonce, GAS_PRICE, recipient.address, weiToSend, authorizationRelayedFundSignature,
                    { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE }
                ),
                'Invalid authorization signature or signer'
            );
        });

        it('[NEGATIVE] Fund should not be executed from non fund executor address', async () => {
            nonDappFundExecutor.signer = nonDappFundExecutor.signer.connect(provider);
            const escrowNonFundExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, nonDappFundExecutor.signer);

            const authorizationFiatFundSignature = await utils.getSignedFundMessage(nonDappFundExecutor.signer, ['uint256', 'address', 'uint256', 'address', 'uint256', 'uint256'], [nonce, escrowContract.contractAddress, GAS_PRICE, recipient.address, weiToSend, tokensToSend]);
            const authorizationRelayedFundSignature = await utils.getSignedFundMessage(nonDappFundExecutor.signer, ['uint256', 'address', 'uint256', 'address', 'uint256'], [nonce, escrowContract.contractAddress, GAS_PRICE, recipient.address, weiToSend]);

            await utils.expectThrow(
                escrowNonFundExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend, tokensToSend, authorizationFiatFundSignature,
                    { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE }
                ),
                'Unauthorized access'
            );

            await utils.expectThrow(
                escrowNonFundExecutor.fundForRelayedPayment(nonce, GAS_PRICE, recipient.address, weiToSend, authorizationRelayedFundSignature,
                    { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE }
                ),
                'Unauthorized access'
            );
        });

        it('[NEGATIVE] Fund should not be executed if fund and refund sum is bigger than contract balance', async () => {
            await utils.expectThrow(
                escrowFundExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend.mul(3), tokensToSend, signedFiatPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE }),
                // escrowSignerExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend.mul(3), tokensToSend, signedFiatPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE }),
            );
        });

        it('Fiat payment should revert if gasprice in authorisation signature is different from tx.gasprice', async () => {
            // Broadcast the transaction with x10 Gas Price. Should refund only 1x Gas Price and not 10x 
            const txPromise = escrowFundExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend, tokensToSend, signedFiatPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE * 10 });
            // const txPromise = escrowSignerExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend, tokensToSend, signedFiatPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE * 10 });
            await utils.expectThrow(txPromise, "Gas price is different from the signed one");
        });

        it('Relayed payment should revert if gasprice in authorisation signature is different from tx.gasprice', async () => {
            // Broadcast the transaction with x10 Gas Price. Should refund only 1x Gas Price and not 10x 
            const txPromise = escrowFundExecutor.fundForRelayedPayment(nonce, GAS_PRICE, recipient.address, weiToSend, signedRelayedPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE * 10 });
            // const txPromise = escrowSignerExecutor.fundForRelayedPayment(nonce, GAS_PRICE, recipient.address, weiToSend, signedRelayedPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE * 10 });
            await utils.expectThrow(txPromise, "Gas price is different from the signed one");
        });
    });

    describe('Fund without funds', () => {
        const addSigner = true;
        let signedFiatPaymentFunds;
        let nonce = utils.generateRandomNonce();

        beforeEach(async () => {
            await initEscrowContract();
            await escrowDappAdminExecutor.editSigner(dAppSigner.address, addSigner);
            recipient = ethers.Wallet.createRandom();
            signedFiatPaymentFunds = await utils.getSignedFundMessage(dAppSigner, ['uint256', 'address', 'uint256', 'address', 'uint256', 'uint256'], [nonce, escrowContract.contractAddress, GAS_PRICE, recipient.address, weiToSend, tokensToSend]);
        });

        it('[NEGATIVE] Shouldn\'t fund with tokens and without ethers', async () => {
            await tokenContract.contract.transfer(escrowContract.contractAddress, tokensToSend.mul(2));

            await utils.expectThrow(
                escrowSignerExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend, tokensToSend, signedFiatPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE }),
                'revert'
            );
        });

        it('[NEGATIVE] Shouldn\'t fund with ethers and without tokens', async () => {
            await deployer.signer.sendTransaction({
                to: escrowContract.contractAddress,
                value: weiToSend.mul(2)
            });

            await utils.expectThrow(
                escrowSignerExecutor.fundForFiatPayment(nonce, GAS_PRICE, recipient.address, weiToSend, tokensToSend, signedFiatPaymentFunds, { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE }),
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
            newSigner = newSigner.connect(provider);

            nonDappAdmin.signer = nonDappAdmin.signer.connect(provider);
        });


        it('dAppAdmin should be able to make other addresses signers', async () => {
            await escrowDappAdminExecutor.editSigner(newSigner.address, addSigner, { gasLimit: GAS_LIMIT });
            assert(await escrowDappAdminExecutor.signers(newSigner.address), 'New signer is not added');
        });

        it('dAppAdmin should be able to remove signer privilege from other addresses', async () => {
            await escrowDappAdminExecutor.editSigner(newSigner.address, addSigner, { gasLimit: GAS_LIMIT });
            assert(await escrowDappAdminExecutor.signers(newSigner.address), 'New signer is not added');

            await escrowDappAdminExecutor.editSigner(newSigner.address, removeSigner, { gasLimit: GAS_LIMIT });
            assert(!await escrowDappAdminExecutor.signers(newSigner.address), 'Added signer has not been removed');
        });

        it('Should get signer address from valid signed message ', async () => {
            const authorizationHash = ethers.utils.solidityKeccak256(['uint256'], [10]);
            const authorizationHashBytes = ethers.utils.arrayify(authorizationHash);
            const authorizationSignature = await dAppSigner.signMessage(authorizationHashBytes);

            const messageSigner = await escrowContract.contract.getSigner(authorizationHash, authorizationSignature);
            assert(messageSigner == dAppSigner.address, 'Invalid signer');
        });

        it('[NEGATIVE] Non-dAppAdmin address should not be able to add or remove another signers privilege', async () => {
            const escrowNonDappAdminExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, nonDappAdmin.signer);

            await utils.expectThrow(
                escrowNonDappAdminExecutor.editSigner(newSigner.address, addSigner, { gasLimit: GAS_LIMIT }),
                'Unauthorized access'
            );

            await utils.expectThrow(
                escrowNonDappAdminExecutor.editSigner(newSigner.address, removeSigner, { gasLimit: GAS_LIMIT }),
                'Unauthorized access'
            );
        });
    });

    describe('Withdrawal functionality', () => {

        beforeEach(async () => {
            await initEscrowContract();
            await setupEscrowContract();

            recipient = ethers.Wallet.createRandom();
            nonSigner.signer = nonSigner.signer.connect(provider);
        });

        it('dAppAdmin should be able to withdraw ethers', async () => {
            const dAppAdminBalanceBeforeWithdraw = await provider.getBalance(dAppAdmin.signer.address);
            let gasCost = await utils.getGasCostFromTx(escrowDappAdminExecutor.withdrawEthers(weiToSend, { gasLimit: GAS_LIMIT }), provider);
            const dAppAdminBalanceAfterWithdraw = await provider.getBalance(dAppAdmin.signer.address);

            assert(dAppAdminBalanceAfterWithdraw.eq(dAppAdminBalanceBeforeWithdraw.add(weiToSend).sub(gasCost)), 'Incorrect withdrawn ethers amount');
        });

        it('dAppAdmin should be able to withdraw tokens', async () => {
            const dAppAdminBalanceBeforeWithdraw = await tokenContract.contract.balanceOf(dAppAdmin.signer.address);
            await escrowDappAdminExecutor.withdrawTokens(tokensToSend, { gasLimit: GAS_LIMIT });
            const dAppAdminBalanceAfterWithdraw = await tokenContract.contract.balanceOf(dAppAdmin.signer.address);

            assert(dAppAdminBalanceBeforeWithdraw.add(tokensToSend).eq(dAppAdminBalanceAfterWithdraw), 'Incorrect withdrawn tokens amount');
        }).timeout(75000);

        it('[NEGATIVE] Non-dAppAdmin should not be able to withdraw ethers', async () => {
            const escrowNonDappAdminExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, nonDappAdmin.signer);

            await utils.expectThrow(
                escrowNonDappAdminExecutor.withdrawEthers(weiToSend, { gasLimit: GAS_LIMIT }),
                'Unauthorized access'
            );
        });

        it('[NEGATIVE] Non-dAppAdmin should not be able to withdraw tokens', async () => {
            const escrowNonDappAdminExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, nonDappAdmin.signer);

            await utils.expectThrow(
                escrowNonDappAdminExecutor.withdrawTokens(tokensToSend, { gasLimit: GAS_LIMIT }),
                'Unauthorized access'
            );
        });

        it('[NEGATIVE] dAppAdmin should not be able to withdraw more ethers than the contract balance', async () => {
            await utils.expectThrow(
                escrowDappAdminExecutor.withdrawEthers(weiToSend.mul(3), { gasLimit: GAS_LIMIT })
            );
        });

        it('[NEGATIVE] dAppAdmin should not be able to withdraw more tokens than the contract balance', async () => {
            await utils.expectThrow(
                escrowDappAdminExecutor.withdrawTokens(tokensToSend.mul(3), { gasLimit: GAS_LIMIT })
            );
        });
    });

    describe('DAppAdmin functionality', () => {

        let randomAddress;
        const ADD = true;
        const REMOVE = false;

        beforeEach(async () => {
            await initEscrowContract();
            randomAddress = utils.getRandomWallet().address;
            nonSigner.signer = nonSigner.signer.connect(provider);
        });

        it('dAppAdmin should be able to set a new dAppAdmin', async () => {
            await escrowDappAdminExecutor.editDappAdmin(randomAddress);
            let newDAppAdminAddress = await escrowDappAdminExecutor.dAppAdmin()

            assert(randomAddress == newDAppAdminAddress, "dApp admin hasn't been changed")
        });

        it('Non dAppAdmin shouldn\'t be able to set a new dAppAdmin', async () => {
            await utils.expectThrow(
                escrowSignerExecutor.editDappAdmin(randomAddress)
            );
        });

        it('dAppAdmin should be able to make other addresses fund executors', async () => {
            await escrowDappAdminExecutor.editFundExecutor(randomAddress, ADD, { gasLimit: GAS_LIMIT });
            assert(await escrowDappAdminExecutor.fundExecutors(randomAddress), 'New fund executor is not added');
        });

        it('dAppAdmin should be able to remove fund executor privilege from other addresses', async () => {
            await escrowDappAdminExecutor.editFundExecutor(randomAddress, ADD, { gasLimit: GAS_LIMIT });
            assert(await escrowDappAdminExecutor.fundExecutors(randomAddress), 'New fund executor is not added');

            await escrowDappAdminExecutor.editFundExecutor(randomAddress, REMOVE, { gasLimit: GAS_LIMIT });
            assert(!await escrowDappAdminExecutor.fundExecutors(randomAddress), 'Added fund executor has not been removed');
        });

        it('[NEGATIVE] Non-dAppAdmin address should not be able to add or remove another fund executor privilege', async () => {
            const escrowNonDappAdminExecutor = new ethers.Contract(escrowContract.contractAddress, EscrowContract.abi, nonDappAdmin.signer);

            await utils.expectThrow(
                escrowNonDappAdminExecutor.editFundExecutor(randomAddress, ADD, { gasLimit: GAS_LIMIT }),
                'Unauthorized access'
            );

            await utils.expectThrow(
                escrowNonDappAdminExecutor.editFundExecutor(randomAddress, REMOVE, { gasLimit: GAS_LIMIT }),
                'Unauthorized access'
            );
        });
    });

    describe('FundExecutor functionality', () => {

        let ecToolContract;

        beforeEach(async () => {
            ecToolContract = await deployRelatedContracts();
        });

        it('Should set funder addresses on deploy', async () => {
            const randomAddress1 = utils.getRandomWallet().address;
            const randomAddress2 = utils.getRandomWallet().address;
            const randomAddress3 = utils.getRandomWallet().address;

            escrowContract = await deployer.deploy(EscrowContract, { ECTools: ecToolContract.contractAddress }, tokenContract.contractAddress, dAppAdmin.signer.address, [randomAddress1, randomAddress2, randomAddress3]);
            
            assert(await escrowContract.fundExecutors(randomAddress1), "RandomAddress1 was not set as funding wallet on deploy");
            assert(await escrowContract.fundExecutors(randomAddress2), "RandomAddress2 was not set as funding wallet on deploy");
            assert(await escrowContract.fundExecutors(randomAddress3), "RandomAddress3 was not set as funding wallet on deploy");

            const randomAddress4 = utils.getRandomWallet().address;
            assert(await escrowContract.fundExecutors(randomAddress4) == false, "RandomAddress4 is funding wallet out of the box");
        })

    });


    async function deployRelatedContracts() {
        deployer = new etherlime.EtherlimeGanacheDeployer(dAppAdmin.signer.privateKey);
        deployer.defaultOverrides = {
            gasLimit: 4700000
        };
        tokenContract = await deployer.deploy(Token);
        const ecToolContract = await deployer.deploy(ECTools);
        return ecToolContract;
    }

    async function verifyContractBalanceAfterRefund(gasUsed, weiToSend) {
        const escrowWeiBalance = await provider.getBalance(escrowContract.contractAddress);
        const txGasCost = gasUsed.mul(GAS_PRICE);
        const expectedEscrowWeiBalance = weiToSend.sub(txGasCost.toString());
        const excessGasRefunded = Number(expectedEscrowWeiBalance.sub(escrowWeiBalance).div(GAS_PRICE).toString());
        assert.closeTo(0, excessGasRefunded, EXCESS_GAS_REFUND_UPPER_LIMIT, 'Incorrect wei balance remaining in the contract');
    }
});


