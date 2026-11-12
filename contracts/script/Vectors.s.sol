// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {BattleEngine} from "../src/engine/BattleEngine.sol";

/// Prints engine results so the NEAR (Rust) port can be checked against this Solidity engine. Lines start with "V,".
contract Vectors is Script {
    function run() external {
        BattleEngine engine = new BattleEngine();
        for (uint256 i = 0; i < 90; i++) {
            bytes32 seed = keccak256(abi.encode("vector", i));
            uint8 a = uint8(i % 3);
            uint8 b = uint8((i / 3) % 3);
            (uint8 w, uint8 r, uint16 x, uint16 y) = engine.simulate(seed, a, b);
            uint256 n = engine.simulateWithLog(seed, a, b).length;
            console2.log(string.concat("V,", vm.toString(seed), ",", vm.toString(a), ",", vm.toString(b), ",", vm.toString(w), ",", vm.toString(r), ",", vm.toString(x), ",", vm.toString(y), ",", vm.toString(n)));
        }
    }
}
