// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMondayRegistry {
    struct Policy {
        bytes32 policyHash;        // keccak256 of the full off-chain policy JSON
        uint32  marketsBitmap;     // bit i = market enabled (BTC=0, ETH=1, SOL=2)
        uint64  maxInventoryUsd;   // whole dollars
        uint64  maxDailyLossUsd;   // whole dollars
        uint16  maxLeverageX100;   // 200 = 2x
        uint8   mode;              // 0 paused, 1 maker, 2 follow
        uint64  updatedAt;
    }

    event PolicySet(address indexed user, bytes32 policyHash, uint32 marketsBitmap,
        uint64 maxInventoryUsd, uint64 maxDailyLossUsd, uint16 maxLeverageX100, uint8 mode);
    event AgentAuthorized(address indexed user, address indexed agent);
    event AgentRevoked(address indexed user, address indexed agent);
    event DecisionLogged(address indexed user, uint32 indexed market, uint256 indexed decisionId,
        bytes32 paramsHash, bytes32 evidenceHash, uint8 regime, string uri);
    event KillLogged(address indexed user, uint8 reason, bytes32 evidenceHash);

    function setPolicy(Policy calldata p) external;            // msg.sender = user
    function authorizeAgent(address agent) external;           // msg.sender = user
    function revokeAgent() external;                           // msg.sender = user
    function logDecision(address user, uint32 market, bytes32 paramsHash,
        bytes32 evidenceHash, uint8 regime, string calldata uri) external; // only authorised agent
    function logKill(address user, uint8 reason, bytes32 evidenceHash) external; // only authorised agent
    function policyOf(address user) external view returns (Policy memory);
    function agentOf(address user) external view returns (address);
}

/// @title MondayRegistry
/// @notice Users publish a risk policy and authorise one agent; that agent logs a hash of every
///         decision and kill. Holds no funds, has no admin and is not upgradeable.
contract MondayRegistry is IMondayRegistry {
    error NotAuthorizedAgent();
    error ZeroAddressAgent();
    error LeverageTooHigh();
    error InvalidMarketsBitmap();
    error InvalidMode();
    error InvalidRegime();
    error InvalidKillReason();
    error UriTooLong();

    uint256 private constant MAX_LEVERAGE_X100 = 5000; // 50x
    uint256 private constant MAX_MARKETS_BITMAP = 7; // BTC | ETH | SOL
    uint256 private constant MAX_MODE = 2; // 0 paused, 1 maker, 2 follow
    uint256 private constant MAX_REGIME = 4; // 0 calm, 1 active, 2 storm, 3 stale, 4 reflex
    uint256 private constant MAX_KILL_REASON = 4; // 0 manual, 1 loss limit, 2 stale data, 3 order failures, 4 key error
    uint256 private constant MAX_URI_BYTES = 200;

    mapping(address user => Policy) private _policies;
    mapping(address user => address agent) public agentOf;
    /// @notice Number of decisions logged for `user`. Equals the latest `decisionId` (ids start at 1).
    mapping(address user => uint256) public decisionCount;

    modifier onlyAgentOf(address user) {
        address agent = agentOf[user];
        // The zero check matters: an eth_call without `from` runs with msg.sender == address(0),
        // which would otherwise match the unset agent of every user.
        if (agent == address(0) || msg.sender != agent) revert NotAuthorizedAgent();
        _;
    }

    function setPolicy(Policy calldata p) external {
        if (p.maxLeverageX100 > MAX_LEVERAGE_X100) revert LeverageTooHigh();
        if (p.marketsBitmap > MAX_MARKETS_BITMAP) revert InvalidMarketsBitmap();
        if (p.mode > MAX_MODE) revert InvalidMode();

        Policy memory stored = p;
        stored.updatedAt = uint64(block.timestamp); // never trust the caller's timestamp
        _policies[msg.sender] = stored;

        emit PolicySet(
            msg.sender, p.policyHash, p.marketsBitmap, p.maxInventoryUsd, p.maxDailyLossUsd, p.maxLeverageX100, p.mode
        );
    }

    function authorizeAgent(address agent) external {
        if (agent == address(0)) revert ZeroAddressAgent();
        agentOf[msg.sender] = agent;
        emit AgentAuthorized(msg.sender, agent);
    }

    /// @dev Never reverts, so it is always safe to call as a kill switch (emits agent = 0 if none was set).
    function revokeAgent() external {
        address old = agentOf[msg.sender];
        delete agentOf[msg.sender];
        emit AgentRevoked(msg.sender, old);
    }

    function logDecision(
        address user,
        uint32 market,
        bytes32 paramsHash,
        bytes32 evidenceHash,
        uint8 regime,
        string calldata uri
    ) external onlyAgentOf(user) {
        if (regime > MAX_REGIME) revert InvalidRegime();
        if (bytes(uri).length > MAX_URI_BYTES) revert UriTooLong();
        uint256 decisionId = ++decisionCount[user];
        emit DecisionLogged(user, market, decisionId, paramsHash, evidenceHash, regime, uri);
    }

    function logKill(address user, uint8 reason, bytes32 evidenceHash) external onlyAgentOf(user) {
        if (reason > MAX_KILL_REASON) revert InvalidKillReason();
        emit KillLogged(user, reason, evidenceHash);
    }

    function policyOf(address user) external view returns (Policy memory) {
        return _policies[user];
    }
}
