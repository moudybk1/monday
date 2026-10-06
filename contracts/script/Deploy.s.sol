// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MondayRegistry} from "../src/MondayRegistry.sol";

contract Deploy is Script {
    function run() external returns (MondayRegistry registry) {
        vm.broadcast();
        registry = new MondayRegistry();
        console2.log("MondayRegistry deployed at:", address(registry));
    }
}
