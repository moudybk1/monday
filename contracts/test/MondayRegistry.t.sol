// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IMondayRegistry, MondayRegistry} from "../src/MondayRegistry.sol";

contract MondayRegistryTest is Test {
    MondayRegistry reg;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address agent = makeAddr("agent");
    address agent2 = makeAddr("agent2");

    bytes32 constant PARAMS = keccak256("params");
    bytes32 constant EVIDENCE = keccak256("evidence");
    string constant URI = "/api/decisions/1";

    function setUp() public {
        reg = new MondayRegistry();
        vm.warp(1_760_000_000);
    }

    function _policy() internal pure returns (IMondayRegistry.Policy memory) {
        return IMondayRegistry.Policy({
            policyHash: keccak256("policy"),
            marketsBitmap: 5,
            maxInventoryUsd: 10_000,
            maxDailyLossUsd: 500,
            maxLeverageX100: 200,
            mode: 1,
            updatedAt: 1 // caller-supplied, must be ignored
        });
    }

    function _authorize(address user, address a) internal {
        vm.prank(user);
        reg.authorizeAgent(a);
    }

    function _log(address caller, address user) internal {
        vm.prank(caller);
        reg.logDecision(user, 0, PARAMS, EVIDENCE, 0, URI);
    }

    // ---------------------------------------------------------------- policy

    function test_SetPolicy_StoresEmitsAndStampsUpdatedAt() public {
        IMondayRegistry.Policy memory p = _policy();

        vm.expectEmit(address(reg));
        emit IMondayRegistry.PolicySet(alice, p.policyHash, 5, 10_000, 500, 200, 1);
        vm.prank(alice);
        reg.setPolicy(p);

        p.updatedAt = uint64(block.timestamp);
        assertEq(abi.encode(reg.policyOf(alice)), abi.encode(p));
        assertEq(reg.policyOf(alice).updatedAt, 1_760_000_000);
    }

    function test_SetPolicy_OnlyAffectsCaller() public {
        vm.prank(alice);
        reg.setPolicy(_policy());

        // bob (and alice's own agent) can only ever write their own slot
        IMondayRegistry.Policy memory other = _policy();
        other.policyHash = keccak256("other");
        other.mode = 2;
        _authorize(alice, agent);
        vm.prank(bob);
        reg.setPolicy(other);
        vm.prank(agent);
        reg.setPolicy(other);

        assertEq(reg.policyOf(alice).policyHash, keccak256("policy"));
        assertEq(reg.policyOf(alice).mode, 1);
        assertEq(reg.policyOf(bob).policyHash, keccak256("other"));
        assertEq(reg.policyOf(agent2).updatedAt, 0); // never set
    }

    function test_SetPolicy_Boundaries() public {
        IMondayRegistry.Policy memory p = _policy();
        p.maxLeverageX100 = 5000;
        p.marketsBitmap = 7;
        p.mode = 2;
        vm.prank(alice);
        reg.setPolicy(p);

        p.maxLeverageX100 = 5001;
        vm.expectRevert(MondayRegistry.LeverageTooHigh.selector);
        vm.prank(alice);
        reg.setPolicy(p);

        p.maxLeverageX100 = 5000;
        p.marketsBitmap = 8;
        vm.expectRevert(MondayRegistry.InvalidMarketsBitmap.selector);
        vm.prank(alice);
        reg.setPolicy(p);

        p.marketsBitmap = 7;
        p.mode = 3;
        vm.expectRevert(MondayRegistry.InvalidMode.selector);
        vm.prank(alice);
        reg.setPolicy(p);
    }

    // ----------------------------------------------------------------- agent

    function test_AuthorizeAgent_SetsAndEmits() public {
        vm.expectEmit(address(reg));
        emit IMondayRegistry.AgentAuthorized(alice, agent);
        _authorize(alice, agent);

        assertEq(reg.agentOf(alice), agent);
        assertEq(reg.agentOf(bob), address(0));
    }

    function test_AuthorizeAgent_RevertsOnZero() public {
        vm.expectRevert(MondayRegistry.ZeroAddressAgent.selector);
        vm.prank(alice);
        reg.authorizeAgent(address(0));
    }

    function test_RevokeAgent_EmitsOldAgentAndOnlyAffectsCaller() public {
        _authorize(alice, agent);
        _authorize(bob, agent2);

        vm.expectEmit(address(reg));
        emit IMondayRegistry.AgentRevoked(alice, agent);
        vm.prank(alice);
        reg.revokeAgent();

        assertEq(reg.agentOf(alice), address(0));
        assertEq(reg.agentOf(bob), agent2);
    }

    // ------------------------------------------------------------------ logs

    function test_LogDecision_ByAgent_EmitsAndIncrements() public {
        _authorize(alice, agent);

        vm.expectEmit(address(reg));
        emit IMondayRegistry.DecisionLogged(alice, 2, 1, PARAMS, EVIDENCE, 4, URI);
        vm.prank(agent);
        reg.logDecision(alice, 2, PARAMS, EVIDENCE, 4, URI);

        vm.expectEmit(address(reg));
        emit IMondayRegistry.DecisionLogged(alice, 0, 2, PARAMS, EVIDENCE, 0, "");
        vm.prank(agent);
        reg.logDecision(alice, 0, PARAMS, EVIDENCE, 0, "");

        assertEq(reg.decisionCount(alice), 2);
    }

    function test_LogDecision_RevertsForNonAgent() public {
        _authorize(alice, agent);
        _authorize(bob, agent2);

        address[4] memory callers = [bob, alice, agent2, address(0)]; // stranger, the user, another user's agent, zero
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(MondayRegistry.NotAuthorizedAgent.selector);
            _log(callers[i], alice);
        }
        assertEq(reg.decisionCount(alice), 0);
    }

    function test_Log_RevertsWhenNoAgentSet_EvenFromZeroAddress() public {
        vm.expectRevert(MondayRegistry.NotAuthorizedAgent.selector);
        _log(address(0), alice);

        vm.expectRevert(MondayRegistry.NotAuthorizedAgent.selector);
        vm.prank(address(0));
        reg.logKill(alice, 0, EVIDENCE);
    }

    function test_Revoke_BlocksAgentImmediately() public {
        _authorize(alice, agent);
        _log(agent, alice);

        vm.prank(alice);
        reg.revokeAgent();

        vm.expectRevert(MondayRegistry.NotAuthorizedAgent.selector);
        _log(agent, alice);
        vm.expectRevert(MondayRegistry.NotAuthorizedAgent.selector);
        vm.prank(agent);
        reg.logKill(alice, 0, EVIDENCE);

        assertEq(reg.decisionCount(alice), 1);
    }

    function test_ReplacingAgent_BlocksOldAgent() public {
        _authorize(alice, agent);
        _authorize(alice, agent2);

        vm.expectRevert(MondayRegistry.NotAuthorizedAgent.selector);
        _log(agent, alice);
        _log(agent2, alice);
        assertEq(reg.decisionCount(alice), 1);
    }

    function test_DecisionId_IncrementsPerUserIndependently() public {
        _authorize(alice, agent);
        _authorize(bob, agent); // same agent serving two users

        _log(agent, alice);
        _log(agent, alice);

        vm.expectEmit(address(reg));
        emit IMondayRegistry.DecisionLogged(bob, 0, 1, PARAMS, EVIDENCE, 0, URI);
        _log(agent, bob);

        vm.expectEmit(address(reg));
        emit IMondayRegistry.DecisionLogged(alice, 0, 3, PARAMS, EVIDENCE, 0, URI);
        _log(agent, alice);

        assertEq(reg.decisionCount(alice), 3);
        assertEq(reg.decisionCount(bob), 1);
    }

    function test_LogDecision_RevertsOnInvalidRegime() public {
        _authorize(alice, agent);
        vm.expectRevert(MondayRegistry.InvalidRegime.selector);
        vm.prank(agent);
        reg.logDecision(alice, 0, PARAMS, EVIDENCE, 5, URI);
    }

    function test_LogDecision_UriBoundary() public {
        _authorize(alice, agent);
        vm.prank(agent);
        reg.logDecision(alice, 0, PARAMS, EVIDENCE, 0, string(new bytes(200)));

        vm.expectRevert(MondayRegistry.UriTooLong.selector);
        vm.prank(agent);
        reg.logDecision(alice, 0, PARAMS, EVIDENCE, 0, string(new bytes(201)));
    }

    function test_LogKill_EmitsAndDoesNotTouchDecisionCount() public {
        _authorize(alice, agent);

        vm.expectEmit(address(reg));
        emit IMondayRegistry.KillLogged(alice, 4, EVIDENCE);
        vm.prank(agent);
        reg.logKill(alice, 4, EVIDENCE);
        assertEq(reg.decisionCount(alice), 0);

        vm.expectRevert(MondayRegistry.InvalidKillReason.selector);
        vm.prank(agent);
        reg.logKill(alice, 5, EVIDENCE);

        vm.expectRevert(MondayRegistry.NotAuthorizedAgent.selector);
        vm.prank(bob);
        reg.logKill(alice, 0, EVIDENCE);
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_SetPolicy_InBounds(address user, IMondayRegistry.Policy memory p, uint32 time) public {
        p.maxLeverageX100 = uint16(bound(p.maxLeverageX100, 0, 5000));
        p.marketsBitmap = uint32(bound(p.marketsBitmap, 0, 7));
        p.mode = uint8(bound(p.mode, 0, 2));
        vm.warp(time);

        vm.prank(user);
        reg.setPolicy(p);

        p.updatedAt = time;
        assertEq(abi.encode(reg.policyOf(user)), abi.encode(p));
    }

    function testFuzz_SetPolicy_RevertsAboveMaxLeverage(IMondayRegistry.Policy memory p) public {
        p.marketsBitmap = uint32(bound(p.marketsBitmap, 0, 7));
        p.mode = uint8(bound(p.mode, 0, 2));
        p.maxLeverageX100 = uint16(bound(p.maxLeverageX100, 5001, type(uint16).max));
        vm.expectRevert(MondayRegistry.LeverageTooHigh.selector);
        reg.setPolicy(p);
    }

    function testFuzz_SetPolicy_RevertsOnBadBitmap(IMondayRegistry.Policy memory p) public {
        p.maxLeverageX100 = uint16(bound(p.maxLeverageX100, 0, 5000));
        p.mode = uint8(bound(p.mode, 0, 2));
        p.marketsBitmap = uint32(bound(p.marketsBitmap, 8, type(uint32).max));
        vm.expectRevert(MondayRegistry.InvalidMarketsBitmap.selector);
        reg.setPolicy(p);
    }

    function testFuzz_SetPolicy_RevertsOnBadMode(IMondayRegistry.Policy memory p) public {
        p.maxLeverageX100 = uint16(bound(p.maxLeverageX100, 0, 5000));
        p.marketsBitmap = uint32(bound(p.marketsBitmap, 0, 7));
        p.mode = uint8(bound(p.mode, 3, type(uint8).max));
        vm.expectRevert(MondayRegistry.InvalidMode.selector);
        reg.setPolicy(p);
    }

    function testFuzz_LogDecision_UriUpTo200BytesSucceeds(uint256 len, uint32 market, uint8 regime) public {
        _authorize(alice, agent);
        vm.prank(agent);
        reg.logDecision(alice, market, PARAMS, EVIDENCE, uint8(bound(regime, 0, 4)), string(new bytes(bound(len, 0, 200))));
        assertEq(reg.decisionCount(alice), 1);
    }

    function testFuzz_LogDecision_UriOver200BytesReverts(uint256 len) public {
        _authorize(alice, agent);
        string memory uri = string(new bytes(bound(len, 201, 4096)));
        vm.expectRevert(MondayRegistry.UriTooLong.selector);
        vm.prank(agent);
        reg.logDecision(alice, 0, PARAMS, EVIDENCE, 0, uri);
    }

    function testFuzz_Log_RevertsOnBadRegimeOrReason(uint8 code) public {
        code = uint8(bound(code, 5, type(uint8).max));
        _authorize(alice, agent);

        vm.expectRevert(MondayRegistry.InvalidRegime.selector);
        vm.prank(agent);
        reg.logDecision(alice, 0, PARAMS, EVIDENCE, code, URI);

        vm.expectRevert(MondayRegistry.InvalidKillReason.selector);
        vm.prank(agent);
        reg.logKill(alice, code, EVIDENCE);
    }

    /// Any caller other than the user's current agent is rejected, whether or not an agent is set.
    function testFuzz_Log_OnlyCurrentAgent(address user, address a, address caller, bool authorized, bool asAgent)
        public
    {
        vm.assume(a != address(0));
        if (authorized) _authorize(user, a);
        if (asAgent) caller = a;

        bool ok = authorized && caller == a;
        if (!ok) vm.expectRevert(MondayRegistry.NotAuthorizedAgent.selector);
        _log(caller, user);
        if (!ok) vm.expectRevert(MondayRegistry.NotAuthorizedAgent.selector);
        vm.prank(caller);
        reg.logKill(user, 0, EVIDENCE);

        assertEq(reg.decisionCount(user), ok ? 1 : 0);
    }
}

/// Drives random authorise / revoke / log sequences over a small actor set, where every actor can be
/// both a user and an agent, and records whether each log attempt agreed with the current agent.
contract RegistryHandler is Test {
    MondayRegistry public reg;
    address[4] public actors;

    uint256 public unauthorizedLogs; // succeeded although the caller was not the user's agent
    uint256 public wronglyBlocked; // reverted although the caller was the user's agent
    mapping(address user => uint256) public ghostDecisions;

    constructor(MondayRegistry _reg) {
        reg = _reg;
        for (uint256 i; i < actors.length; ++i) {
            actors[i] = vm.addr(i + 1);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function authorize(uint256 userSeed, uint256 agentSeed) external {
        vm.prank(_actor(userSeed));
        reg.authorizeAgent(_actor(agentSeed));
    }

    function revoke(uint256 userSeed) external {
        vm.prank(_actor(userSeed));
        reg.revokeAgent();
    }

    function logDecision(uint256 callerSeed, uint256 userSeed, uint32 market, uint8 regime) external {
        address caller = _actor(callerSeed);
        address user = _actor(userSeed);
        bool isAgent = reg.agentOf(user) == caller;

        vm.prank(caller);
        try reg.logDecision(user, market, bytes32(callerSeed), bytes32(userSeed), regime % 5, "/api/decisions/x") {
            ++ghostDecisions[user];
            if (!isAgent) ++unauthorizedLogs;
        } catch {
            if (isAgent) ++wronglyBlocked;
        }
    }

    function logKill(uint256 callerSeed, uint256 userSeed, uint8 reason) external {
        address caller = _actor(callerSeed);
        address user = _actor(userSeed);
        bool isAgent = reg.agentOf(user) == caller;

        vm.prank(caller);
        try reg.logKill(user, reason % 5, bytes32(userSeed)) {
            if (!isAgent) ++unauthorizedLogs;
        } catch {
            if (isAgent) ++wronglyBlocked;
        }
    }
}

contract MondayRegistryInvariantTest is Test {
    MondayRegistry reg;
    RegistryHandler handler;

    function setUp() public {
        reg = new MondayRegistry();
        handler = new RegistryHandler(reg);
        targetContract(address(handler));
    }

    /// A successful log for a user always comes from that user's current agent, and the current
    /// agent is never blocked.
    function invariant_LogsOnlyFromCurrentAgent() public view {
        assertEq(handler.unauthorizedLogs(), 0, "log accepted from non-agent");
        assertEq(handler.wronglyBlocked(), 0, "current agent was blocked");
    }

    /// decisionCount only moves through accepted logDecision calls.
    function invariant_DecisionCountMatchesAcceptedLogs() public view {
        for (uint256 i; i < 4; ++i) {
            address user = handler.actors(i);
            assertEq(reg.decisionCount(user), handler.ghostDecisions(user));
        }
    }
}
