// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract ArcPay {
    IERC20 public immutable usdc;
    address public owner;

    event Paid(address indexed from, address indexed to, uint256 amount, bytes32 ref);

    constructor(address usdc_) {
        require(usdc_ != address(0), "usdc required");
        usdc = IERC20(usdc_);
        owner = msg.sender;
    }

    function pay(address to, uint256 amount, bytes32 ref) external {
        require(to != address(0) && amount > 0, "bad payment");
        require(usdc.transferFrom(msg.sender, to, amount), "usdc transfer failed");
        emit Paid(msg.sender, to, amount, ref);
    }
}
