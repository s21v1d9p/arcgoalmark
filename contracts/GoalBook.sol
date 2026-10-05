// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title GoalBook
/// @notice Savings goals, one per wallet and vault. It never holds funds and has no owner.
/// The money stays in the vault; `deposited` is the wallet's own record of what it put in.
contract GoalBook {
    uint256 public constant MAX_GOALS = 20;
    uint256 public constant MAX_NAME_BYTES = 64;

    struct Goal {
        address vault;
        uint64 deadline;
        uint64 createdAt;
        uint256 target;
        uint256 deposited;
        string name;
    }

    mapping(address owner => Goal[]) private goals;
    mapping(address owner => mapping(address vault => uint256)) private positions;

    event GoalSet(address indexed owner, address indexed vault, string name, uint256 target, uint64 deadline);
    event GoalRemoved(address indexed owner, address indexed vault);
    event DepositRecorded(address indexed owner, address indexed vault, uint256 amount, uint256 deposited);
    event WithdrawalRecorded(address indexed owner, address indexed vault, uint256 amount, uint256 deposited);

    error InvalidVault();
    error InvalidName();
    error InvalidTarget();
    error TooManyGoals();
    error UnknownGoal();

    function setGoal(address vault, string calldata name, uint256 target, uint64 deadline) external {
        if (vault.code.length == 0) revert InvalidVault();
        uint256 nameLength = bytes(name).length;
        if (nameLength == 0 || nameLength > MAX_NAME_BYTES) revert InvalidName();
        if (target == 0) revert InvalidTarget();

        uint256 position = positions[msg.sender][vault];
        if (position == 0) {
            Goal[] storage list = goals[msg.sender];
            if (list.length >= MAX_GOALS) revert TooManyGoals();
            list.push(Goal(vault, deadline, uint64(block.timestamp), target, 0, name));
            positions[msg.sender][vault] = list.length;
        } else {
            Goal storage goal = goals[msg.sender][position - 1];
            goal.name = name;
            goal.target = target;
            goal.deadline = deadline;
        }
        emit GoalSet(msg.sender, vault, name, target, deadline);
    }

    function removeGoal(address vault) external {
        uint256 index = _index(msg.sender, vault);
        Goal[] storage list = goals[msg.sender];
        uint256 last = list.length - 1;
        if (index != last) {
            list[index] = list[last];
            positions[msg.sender][list[index].vault] = index + 1;
        }
        list.pop();
        delete positions[msg.sender][vault];
        emit GoalRemoved(msg.sender, vault);
    }

    function recordDeposit(address vault, uint256 amount) external {
        Goal storage goal = goals[msg.sender][_index(msg.sender, vault)];
        goal.deposited += amount;
        emit DepositRecorded(msg.sender, vault, amount, goal.deposited);
    }

    function recordWithdrawal(address vault, uint256 amount) external {
        Goal storage goal = goals[msg.sender][_index(msg.sender, vault)];
        goal.deposited = amount >= goal.deposited ? 0 : goal.deposited - amount;
        emit WithdrawalRecorded(msg.sender, vault, amount, goal.deposited);
    }

    function goalsOf(address owner) external view returns (Goal[] memory) {
        return goals[owner];
    }

    function goalOf(address owner, address vault) external view returns (Goal memory) {
        return goals[owner][_index(owner, vault)];
    }

    function _index(address owner, address vault) private view returns (uint256) {
        uint256 position = positions[owner][vault];
        if (position == 0) revert UnknownGoal();
        return position - 1;
    }
}
