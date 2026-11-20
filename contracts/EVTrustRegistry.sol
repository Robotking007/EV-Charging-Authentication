// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title EVTrustRegistry
/// @notice On-chain identity, mutual-authentication and dynamic trust-score
///         registry for EV charging authentication.
/// @dev Trust score updates and slashes require M-of-N approval from
///      ORACLE_ROLE members instead of a single admin key, so no single
///      consortium member can unilaterally set an entity's score.
contract EVTrustRegistry is AccessControl {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    uint32 public constant MAX_SCORE_E4 = 10000;

    enum ActionType { ScoreUpdate, Slash }

    struct Entity {
        bool registered;
        bool isStation;          // false = EV, true = charging station
        address pubKey;          // on-chain identity (secp256k1 address)
        uint32 trustScoreE4;     // trust score scaled by 1e4 (0..10000)
        uint32 sessionsTotal;
        uint32 sessionsFailed;
        uint64 lastUpdated;
    }

    struct Proposal {
        ActionType actionType;
        bytes32 didHash;
        uint32 valueE4;       // newScoreE4 for ScoreUpdate, penaltyE4 for Slash
        bool sessionOk;       // meaningful only for ScoreUpdate
        uint32 approvalCount;
        bool executed;
    }

    enum PaymentState { None, Funded, Settled, Refunded }

    struct ChargingSession {
        bytes32 evId;
        bytes32 stationId;
        address evAccount;
        address stationAccount;
        uint64 maxWh;
        uint64 expiresAt;
        uint256 pricePerWh;
        PaymentState paymentState;
    }

    /// @notice Minimum trust score (scaled by 1e4) required by BOTH parties
    ///         for a session to be authorized. Settable by the admin role.
    uint32 public minTrustScoreE4 = 3000;

    /// @notice Number of distinct oracle approvals required to execute a
    ///         proposed score update or slash.
    uint32 public requiredApprovals;

    mapping(bytes32 => Entity) public entities;              // DID hash => Entity
    mapping(bytes32 => bool) public usedNonces;               // replay protection
    mapping(bytes32 => Proposal) public proposals;
    mapping(bytes32 => mapping(address => bool)) public hasApproved;
    mapping(bytes32 => bool) public revoked;
    mapping(bytes32 => ChargingSession) public chargingSessions;
    mapping(address => uint256) public withdrawable;
    mapping(bytes32 => mapping(bytes32 => bytes32)) public settlementScoreProposals;
    mapping(bytes32 => mapping(bytes32 => mapping(uint32 => bytes32))) public settlementScoreCandidates;
    mapping(bytes32 => uint64) private _settledEnergyWh;
    mapping(bytes32 => bytes32) private _proposalSession;
    uint256 private _proposalNonce;
    mapping(bytes32 => uint256) private _scoreProposalSequence;
    mapping(bytes32 => uint256) private _latestAppliedScoreSequence;

    event Registered(bytes32 indexed didHash, bool isStation);
    event IdentityKeyChanged(bytes32 indexed didHash, address newKey);
    event IdentityRevoked(bytes32 indexed didHash);
    event SessionAuthenticated(bytes32 indexed evId, bytes32 indexed stationId, bytes32 sessionId);
    event SessionDenied(bytes32 indexed evId, bytes32 indexed stationId, bytes32 sessionId);
    event ProposalCreated(bytes32 indexed proposalId, ActionType actionType, bytes32 indexed didHash);
    event ProposalApproved(bytes32 indexed proposalId, address indexed approver, uint32 approvalCount);
    event TrustScoreUpdated(bytes32 indexed didHash, uint32 newScoreE4);
    event Slashed(bytes32 indexed didHash, uint32 penaltyE4, uint32 newScoreE4);
    event MinTrustScoreChanged(uint32 newMinTrustScoreE4);
    event RequiredApprovalsChanged(uint32 newRequiredApprovals);
    event SessionFunded(bytes32 indexed sessionId, uint64 maxWh, uint256 pricePerWh, uint64 expiresAt);
    event SessionSettled(bytes32 indexed sessionId, bytes32 indexed evId, bytes32 indexed stationId, uint64 energyWh, uint256 paid);
    event SessionRefunded(bytes32 indexed sessionId);

    constructor(uint32 requiredApprovals_) {
        require(requiredApprovals_ >= 1, "need >=1 approval");
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
        requiredApprovals = requiredApprovals_;
    }

    // ---------------------------------------------------------------
    // Identity registration
    // ---------------------------------------------------------------

    /// @notice Register an EV or charging station identity.
    function register(bytes32 didHash, address pubKey, bool isStation) external onlyRole(REGISTRAR_ROLE) {
        require(!entities[didHash].registered, "already registered");
        require(pubKey != address(0), "bad pubkey");
        entities[didHash] = Entity({
            registered: true,
            isStation: isStation,
            pubKey: pubKey,
            trustScoreE4: 5000,        // neutral prior, Beta(1,1) => 0.5
            sessionsTotal: 0,
            sessionsFailed: 0,
            lastUpdated: uint64(block.timestamp)
        });
        emit Registered(didHash, isStation);
    }

    function rotateIdentityKey(bytes32 didHash, address newKey) external onlyRole(REGISTRAR_ROLE) {
        require(entities[didHash].registered && !revoked[didHash], "inactive entity");
        require(newKey != address(0), "bad pubkey");
        entities[didHash].pubKey = newKey;
        emit IdentityKeyChanged(didHash, newKey);
    }

    function revokeIdentity(bytes32 didHash) external onlyRole(REGISTRAR_ROLE) {
        require(entities[didHash].registered && !revoked[didHash], "inactive entity");
        revoked[didHash] = true;
        emit IdentityRevoked(didHash);
    }

    // ---------------------------------------------------------------
    // Mutual authentication + trust-gated authorization
    // ---------------------------------------------------------------

    /// @notice Verify a mutual authentication challenge and evaluate whether
    ///         the session is authorized based on both parties' current
    ///         trust scores (Figure 2: authenticate, then check threshold).
    /// @dev EV and station each sign keccak256(evId, stationId, nonce,
    ///      address(this), block.chainid) off-chain. Denied sessions still
    ///      consume the nonce and are recorded on-chain via SessionDenied
    ///      so they can be flagged for review, rather than silently reverting.
    function authenticateSession(
        bytes32 evId,
        bytes32 stationId,
        bytes32 nonce,
        bytes calldata evSig,
        bytes calldata stationSig
    ) external returns (bytes32 sessionId, bool authorized) {
        require(!usedNonces[nonce], "nonce reused");
        Entity storage ev = entities[evId];
        Entity storage station = entities[stationId];
        require(ev.registered && !ev.isStation && !revoked[evId], "bad ev");
        require(station.registered && station.isStation && !revoked[stationId], "bad station");

        bytes32 digest = keccak256(
            abi.encodePacked(evId, stationId, nonce, address(this), block.chainid)
        ).toEthSignedMessageHash();

        require(digest.recover(evSig) == ev.pubKey, "ev sig invalid");
        require(digest.recover(stationSig) == station.pubKey, "station sig invalid");

        usedNonces[nonce] = true;
        sessionId = keccak256(abi.encodePacked(evId, stationId, nonce, block.timestamp));

        authorized = ev.trustScoreE4 >= minTrustScoreE4 && station.trustScoreE4 >= minTrustScoreE4;
        if (authorized) {
            ChargingSession storage session = chargingSessions[sessionId];
            session.evId = evId;
            session.stationId = stationId;
            session.evAccount = ev.pubKey;
            session.stationAccount = station.pubKey;
            emit SessionAuthenticated(evId, stationId, sessionId);
        } else {
            emit SessionDenied(evId, stationId, sessionId);
        }
    }

    /// @notice Prepay a maximum energy budget. pricePerWh is in wei.
    function fundSession(bytes32 sessionId, uint64 maxWh, uint256 pricePerWh, uint64 expiresAt) external payable {
        ChargingSession storage session = chargingSessions[sessionId];
        require(msg.sender == session.evAccount, "only authorized EV");
        require(session.paymentState == PaymentState.None, "already funded");
        require(!revoked[session.evId] && !revoked[session.stationId], "inactive participant");
        require(entities[session.evId].pubKey == session.evAccount && entities[session.stationId].pubKey == session.stationAccount, "keys changed");
        require(maxWh > 0 && pricePerWh > 0 && msg.value == maxWh * pricePerWh, "incorrect deposit");
        require(expiresAt > block.timestamp, "invalid expiry");
        session.maxWh = maxWh;
        session.pricePerWh = pricePerWh;
        session.expiresAt = expiresAt;
        session.paymentState = PaymentState.Funded;
        emit SessionFunded(sessionId, maxWh, pricePerWh, expiresAt);
    }

    /// @notice Both participants attest the same metered energy. Zero Wh records a failed charge.
    function settleSession(bytes32 sessionId, uint64 energyWh, bytes calldata evSig, bytes calldata stationSig) external {
        ChargingSession storage session = chargingSessions[sessionId];
        require(session.paymentState == PaymentState.Funded && block.timestamp < session.expiresAt, "session not settleable");
        require(energyWh <= session.maxWh, "energy exceeds budget");
        bytes32 digest = keccak256(abi.encode(
            sessionId, energyWh, session.maxWh, session.pricePerWh, session.expiresAt, address(this), block.chainid
        )).toEthSignedMessageHash();
        require(digest.recover(evSig) == session.evAccount, "invalid EV meter signature");
        require(digest.recover(stationSig) == session.stationAccount, "invalid station meter signature");

        session.paymentState = PaymentState.Settled;
        _settledEnergyWh[sessionId] = energyWh;
        uint256 paid = energyWh * session.pricePerWh;
        withdrawable[session.stationAccount] += paid;
        withdrawable[session.evAccount] += (session.maxWh - energyWh) * session.pricePerWh;
        emit SessionSettled(sessionId, session.evId, session.stationId, energyWh, paid);
    }

    function refundExpiredSession(bytes32 sessionId) external {
        ChargingSession storage session = chargingSessions[sessionId];
        require(session.paymentState == PaymentState.Funded && block.timestamp >= session.expiresAt, "session not refundable");
        session.paymentState = PaymentState.Refunded;
        withdrawable[session.evAccount] += session.maxWh * session.pricePerWh;
        emit SessionRefunded(sessionId);
    }

    function withdrawPayments() external {
        uint256 amount = withdrawable[msg.sender];
        require(amount > 0, "no payment");
        withdrawable[msg.sender] = 0;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "payment transfer failed");
    }

    // ---------------------------------------------------------------
    // Trust score updates and slashing (M-of-N oracle consensus)
    // ---------------------------------------------------------------

    /// @notice Propose a Beta-reputation score update computed off-chain.
    ///         Counts as the proposer's own approval; executes immediately
    ///         if requiredApprovals == 1.
    function proposeScoreUpdate(bytes32 didHash, uint32 newScoreE4, bool sessionOk)
        external
        onlyRole(ORACLE_ROLE)
        returns (bytes32 proposalId)
    {
        return _proposeScoreUpdate(didHash, newScoreE4, sessionOk);
    }

    function proposeSettlementScore(bytes32 sessionId, bytes32 didHash, uint32 newScoreE4)
        external onlyRole(ORACLE_ROLE) returns (bytes32 proposalId)
    {
        ChargingSession storage session = chargingSessions[sessionId];
        require(session.paymentState == PaymentState.Settled, "session not settled");
        require(didHash == session.evId || didHash == session.stationId, "not a participant");
        require(settlementScoreProposals[sessionId][didHash] == bytes32(0), "settlement score applied");
        require(settlementScoreCandidates[sessionId][didHash][newScoreE4] == bytes32(0), "score already proposed");
        return _createScoreProposal(didHash, newScoreE4, _settledEnergyWh[sessionId] > 0, sessionId);
    }

    function _proposeScoreUpdate(bytes32 didHash, uint32 newScoreE4, bool sessionOk) internal returns (bytes32 proposalId) {
        return _createScoreProposal(didHash, newScoreE4, sessionOk, bytes32(0));
    }

    function _createScoreProposal(bytes32 didHash, uint32 newScoreE4, bool sessionOk, bytes32 sessionId)
        private returns (bytes32 proposalId)
    {
        require(entities[didHash].registered, "unknown entity");
        require(newScoreE4 <= MAX_SCORE_E4, "score out of range");

        proposalId = keccak256(abi.encodePacked(ActionType.ScoreUpdate, didHash, newScoreE4, sessionOk, _proposalNonce++));
        _scoreProposalSequence[proposalId] = _proposalNonce;
        if (sessionId != bytes32(0)) {
            settlementScoreCandidates[sessionId][didHash][newScoreE4] = proposalId;
            _proposalSession[proposalId] = sessionId;
        }
        proposals[proposalId] = Proposal({
            actionType: ActionType.ScoreUpdate,
            didHash: didHash,
            valueE4: newScoreE4,
            sessionOk: sessionOk,
            approvalCount: 0,
            executed: false
        });
        emit ProposalCreated(proposalId, ActionType.ScoreUpdate, didHash);
        _approve(proposalId);
    }

    /// @notice Propose a direct penalty for provable misbehavior, applied
    ///         independently of the decayed reputation average.
    function proposeSlash(bytes32 didHash, uint32 penaltyE4)
        external
        onlyRole(ORACLE_ROLE)
        returns (bytes32 proposalId)
    {
        require(entities[didHash].registered, "unknown entity");
        require(penaltyE4 > 0 && penaltyE4 <= MAX_SCORE_E4, "penalty out of range");

        proposalId = keccak256(abi.encodePacked(ActionType.Slash, didHash, penaltyE4, _proposalNonce++));
        proposals[proposalId] = Proposal({
            actionType: ActionType.Slash,
            didHash: didHash,
            valueE4: penaltyE4,
            sessionOk: false,
            approvalCount: 0,
            executed: false
        });
        emit ProposalCreated(proposalId, ActionType.Slash, didHash);
        _approve(proposalId);
    }

    /// @notice Add an additional oracle approval to a pending proposal.
    function approveProposal(bytes32 proposalId) external onlyRole(ORACLE_ROLE) {
        require(proposals[proposalId].approvalCount != 0, "unknown proposal");
        _approve(proposalId);
    }

    function _approve(bytes32 proposalId) internal {
        Proposal storage p = proposals[proposalId];
        require(!p.executed, "already executed");
        require(!hasApproved[proposalId][msg.sender], "already approved");

        hasApproved[proposalId][msg.sender] = true;
        p.approvalCount += 1;
        emit ProposalApproved(proposalId, msg.sender, p.approvalCount);

        if (p.approvalCount >= requiredApprovals) {
            _execute(proposalId, p);
        }
    }

    function _execute(bytes32 proposalId, Proposal storage p) internal {
        p.executed = true;
        Entity storage e = entities[p.didHash];

        if (p.actionType == ActionType.ScoreUpdate) {
            bytes32 sessionId = _proposalSession[proposalId];
            if (sessionId != bytes32(0)) {
                if (settlementScoreProposals[sessionId][p.didHash] != bytes32(0)) return;
                settlementScoreProposals[sessionId][p.didHash] = proposalId;
            }
            e.sessionsTotal += 1;
            if (!p.sessionOk) e.sessionsFailed += 1;
            uint256 sequence = _scoreProposalSequence[proposalId];
            if (sequence > _latestAppliedScoreSequence[p.didHash]) {
                _latestAppliedScoreSequence[p.didHash] = sequence;
                e.trustScoreE4 = p.valueE4;
                e.lastUpdated = uint64(block.timestamp);
                emit TrustScoreUpdated(p.didHash, p.valueE4);
            }
        } else {
            uint32 newScore = e.trustScoreE4 > p.valueE4 ? e.trustScoreE4 - p.valueE4 : 0;
            e.trustScoreE4 = newScore;
            e.lastUpdated = uint64(block.timestamp);
            emit Slashed(p.didHash, p.valueE4, newScore);
        }
    }

    // ---------------------------------------------------------------
    // Consortium admin
    // ---------------------------------------------------------------

    function setMinTrustScore(uint32 newMinTrustScoreE4) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMinTrustScoreE4 <= MAX_SCORE_E4, "out of range");
        minTrustScoreE4 = newMinTrustScoreE4;
        emit MinTrustScoreChanged(newMinTrustScoreE4);
    }

    function setRequiredApprovals(uint32 newRequiredApprovals) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRequiredApprovals >= 1, "need >=1 approval");
        requiredApprovals = newRequiredApprovals;
        emit RequiredApprovalsChanged(newRequiredApprovals);
    }
}
