// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract EscrowContract {
    enum Status {
        EMPTY,
        FUNDED,
        RELEASED,
        REFUNDED
    }

    struct Escrow {
        uint256 escrowId;
        address buyer;
        address seller;
        uint256 amount;
        Status status;
        bool exists;
    }

    mapping(uint256 => Escrow) public escrows;

    event EscrowCreated(uint256 indexed escrowId, address indexed buyer, address seller);
    event FundsFunded(uint256 indexed escrowId, address indexed buyer, address seller, uint256 amount);
    event FundsReleased(uint256 indexed escrowId, address indexed buyer, address seller, uint256 amount);
    event FundsRefunded(uint256 indexed escrowId, address indexed buyer, uint256 amount);

    function createEscrow(uint256 _escrowId, address _seller) public {
        // Few Checks:
        // 1. Buyer and seller cannot be the same
        require(msg.sender != _seller, "You cannot create an escrow with yourself");
        // 2. Escrow must not exist
        require(!escrows[_escrowId].exists, "Escrow already exists");

        escrows[_escrowId] = Escrow({
            escrowId: _escrowId,
            buyer: msg.sender,
            seller: _seller,
            amount: 0,
            status: Status.EMPTY,
            exists: true
        });

        emit EscrowCreated(_escrowId, msg.sender, _seller);
    }

    function depositFunds(uint256 _escrowId) payable public {
        Escrow storage e = escrows[_escrowId];

        // Few Checks:
        // 1. Escrow must exist
        require(e.exists, "Escrow does not exist");
        // 2. Only the buyer can deposit funds
        require(e.buyer == msg.sender, "Only the buyer can deposit funds");
        // 3. Amount must be greater than 0
        require(msg.value > 0, "Amount must be greater than 0");
        // 4. Escrow must be empty
        require(e.status == Status.EMPTY, "Escrow not empty");

        e.status = Status.FUNDED;
        e.amount = msg.value;
        emit FundsFunded(_escrowId, msg.sender, e.seller, msg.value);
    }

    // Only Buyer can release/refund funds
    function releaseFunds(uint256 _escrowId) public {
        Escrow storage e = escrows[_escrowId];

        // Few Checks:
        // 1. Escrow must exist
        require(e.exists, "Escrow does not exist");
        // 2. Only the buyer can release funds
        require(e.buyer == msg.sender, "Only the buyer can release funds");
        // 3. Escrow must be funded
        require(e.status == Status.FUNDED, "Escrow not funded");

        // External call: sends ETH to the buyer's address.
        // State is updated before this call to prevent reentrancy attacks.

        // Effects: Update state before interacting with external accounts
        e.status = Status.RELEASED;
        uint256 amount = e.amount;
        e.amount = 0; // Zero out the amount before sending

        emit FundsReleased(_escrowId, msg.sender, e.seller, amount);
        // Interactions: External call last (Checks-Effects-Interactions pattern)
        // e.seller = seller address
        (bool success, ) = payable(e.seller).call{value: amount}("");
        require(success, "Failed to release funds"); // Revert the transaction if failed
    }
    
    function refundFunds(uint256 _escrowId) public {
        Escrow storage e = escrows[_escrowId];

        // Few Checks:
        // 1. Escrow must exist
        require(e.exists, "Escrow does not exist");
        // 2. Only the buyer can refund funds
        require(e.buyer == msg.sender, "Only the buyer can refund funds");
        // 3. Escrow must be funded
        require(e.status == Status.FUNDED, "Escrow not funded");

        // External call: sends ETH to the buyer's address.
        // State is updated before this call to prevent reentrancy attacks.

        // Effects: Update state before interacting with external accounts
        e.status = Status.REFUNDED;
        uint256 amount = e.amount;
        e.amount = 0; // Zero out the amount before sending
        
        // Interactions: External call last (Checks-Effects-Interactions pattern)
        // msg.sender = buyer address
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Failed to refund funds"); // Revert the transaction if failed
        emit FundsRefunded(_escrowId, msg.sender, amount);
    }

    function getEscrow(uint256 _escrowId) public view returns (Escrow memory) {
        Escrow storage e = escrows[_escrowId];
        // Few Checks:
        // 1. Escrow must exist
        require(e.exists, "Escrow does not exist");
        
        return escrows[_escrowId];
    }
}