pragma solidity 0.5.1;

import "./ECTools.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

/**
 * @title Escrow_V3
 * @dev Escrow_V3 is the latest version of the escrow contract, currently being used for production
 */
contract Escrow_V3 {
    using SafeMath for uint256;

    ERC20 public tokenContract;

    mapping (address => bool) public signers;
    mapping (uint256 => bool) public usedNonces;

    address payable public dAppAdmin;
    uint256 constant public REFUNDING_LOGIC_GAS_COST = 7901; // gas used for single refund

    uint256 constant public FIAT_PAYMENT_FUND_FUNCTION_CALL_GAS_USED = 32831; // approximated gas for calling fundForFiatPayment
    uint256 constant public RELAYED_PAYMENT_FUND_FUNCTION_CALL_GAS_USED = 32323; // approximated gas for calling fundForRelayedPayment

    /**
    * @dev Restricts the access to a given function to the dApp admin only
    */
    modifier onlyDAppAdmin() {
        require(msg.sender == dAppAdmin, "Unauthorized access");
        _;
    }

    /**
    * @dev Checks whether the nonce in the authorisation signature was already used. Prevents replay attacks.
    */
    modifier preValidateFund(uint256 nonce) {
        require(!usedNonces[nonce], "Nonce already used");
        _;
    }

    /**
    * @dev The token address and the dappadmin are set on contract creation
    */
    constructor(address tokenAddress, address payable _dAppAdmin) public {
        dAppAdmin = _dAppAdmin;
        tokenContract = ERC20(tokenAddress);
    }
   
    /**
    * @dev Funds the `addressToFund` with the proided `weiAmount`
    * Signature from the dapp is used in order to authorize the funding
    * The msg sender is refunded for the transaction costs
    */
    function fundForRelayedPayment(
        uint256 nonce,
        uint256 gasprice,
        address payable addressToFund,
        uint256 weiAmount,
        bytes memory authorizationSignature) public preValidateFund(nonce)
    {
        uint256 gasLimit = gasleft().add(RELAYED_PAYMENT_FUND_FUNCTION_CALL_GAS_USED);

        bytes32 hashedParameters = keccak256(abi.encodePacked(nonce, address(this), gasprice, addressToFund, weiAmount));
        _preFund(hashedParameters, authorizationSignature, nonce);

        addressToFund.transfer(weiAmount);

        _refundMsgSender(gasLimit, gasprice);
    }

    /**
    * @dev Funds the `addressToFund` with the proided `weiAmount` and `tokenAmount`
    * Signature from the dapp is used in order to authorize the funding
    * The msg sender is refunded for the transaction costs
    */
    function fundForFiatPayment(
        uint256 nonce,
        uint256 gasprice,
        address payable addressToFund,
        uint256 weiAmount,
        uint256 tokenAmount,
        bytes memory authorizationSignature) public preValidateFund(nonce)
    {
        uint256 gasLimit = gasleft().add(FIAT_PAYMENT_FUND_FUNCTION_CALL_GAS_USED);

        bytes32 hashedParameters = keccak256(abi.encodePacked(nonce, address(this), gasprice, addressToFund, weiAmount, tokenAmount));
        _preFund(hashedParameters, authorizationSignature, nonce);

        tokenContract.transfer(addressToFund, tokenAmount);
        addressToFund.transfer(weiAmount);

        _refundMsgSender(gasLimit, gasprice);
    }

    /**
    * @dev Recovers the signer and checks whether the person that signed the signature is whitelisted as `signer`. Marks the nonce as used
    */
    function _preFund(bytes32 hashedParameters, bytes memory authorizationSignature, uint256 nonce) internal {
        address signer = getSigner(hashedParameters, authorizationSignature);
        require(signers[signer], "Invalid authorization signature or signer");

        usedNonces[nonce] = true;
    }

    /**
    * @dev performs EC recover on the signature
    */
    function getSigner(bytes32 raw, bytes memory sig) public pure returns(address signer) {
        return ECTools.prefixedRecover(raw, sig);
    }

    /**
    * @dev refunds the msg sender for the transaction costs
    */
    function _refundMsgSender(uint256 gasLimit, uint256 gasprice) internal {
        uint256 refundAmount = gasLimit.sub(gasleft()).add(REFUNDING_LOGIC_GAS_COST).mul(gasprice);
        msg.sender.transfer(refundAmount);
    }

    /**
    * @dev withdraws the ethers in the escrow contract. Performed only by the dAppAdmin
    */
    function withdrawEthers(uint256 ethersAmount) public onlyDAppAdmin {
        dAppAdmin.transfer(ethersAmount);
    }

    /**
    * @dev withdraws the tokens in the escrow contract. Performed only by the dAppAdmin
    */
    function withdrawTokens(uint256 tokensAmount) public onlyDAppAdmin {
        tokenContract.transfer(dAppAdmin, tokensAmount);
    }

    /**
    * @dev marks a given address as signer or not, depending on the second bool parameter. Performed only by the dAppAdmin
    */
    function editSigner(address _newSigner, bool add) public onlyDAppAdmin {
        signers[_newSigner] = add;
    }

    /**
    * @dev changes the dAppAdmin of the contract. Performed only by the dAppAdmin
    */
    function editDappAdmin (address payable _dAppAdmin) public onlyDAppAdmin {
        dAppAdmin = _dAppAdmin;
    }

    function() external payable {}
}