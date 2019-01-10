# Limepay Escrow Contract
This repo represents the production grade smart contracts needed to achieve trustless escrow system. This system has several goals:
- Be an escrow for a client dapp funds for the Limepay system without giving any control to it to Limepay
- Be able to maintain the atomic properties that Limepay emulates by not allowing the client to retract their intent to fund a user
- Be as cheap as possible to create and run without compromising the security of the contract
