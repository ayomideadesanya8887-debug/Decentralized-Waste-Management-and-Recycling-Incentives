import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface MintRecord {
  amount: number;
  recipient: string;
  metadata: string;
  timestamp: number;
}

interface VestingSchedule {
  amount: number;
  start: number;
  duration: number;
  claimed: number;
}

interface ContractState {
  totalSupply: number;
  contractPaused: boolean;
  contractAdmin: string;
  balances: Map<string, number>;
  minters: Map<string, boolean>;
  mintRecords: Map<number, MintRecord>;
  vestingSchedules: Map<string, VestingSchedule>; // Key as `${recipient}_${id}`
  allowances: Map<string, number>; // Key as `${owner}_${spender}`
  blockHeight: number; // Mocked block height
}

// Mock contract implementation
class TokenManagerMock {
  private state: ContractState = {
    totalSupply: 0,
    contractPaused: false,
    contractAdmin: "deployer",
    balances: new Map(),
    minters: new Map(),
    mintRecords: new Map(),
    vestingSchedules: new Map(),
    allowances: new Map(),
    blockHeight: 100, // Starting block height
  };

  private MAX_METADATA_LEN = 500;
  private ERR_UNAUTHORIZED = 100;
  private ERR_PAUSED = 101;
  private ERR_INVALID_AMOUNT = 102;
  private ERR_INVALID_RECIPIENT = 103;
  private ERR_INVALID_MINTER = 104;
  private ERR_ALREADY_REGISTERED = 105;
  private ERR_METADATA_TOO_LONG = 106;
  private ERR_INSUFFICIENT_BALANCE = 107;
  private ERR_VESTING_NOT_FOUND = 108;
  private ERR_VESTING_NOT_MATURE = 109;

  // Helper to advance block height
  advanceBlockHeight(blocks: number) {
    this.state.blockHeight += blocks;
  }

  getName(): ClarityResponse<string> {
    return { ok: true, value: "RecycleToken" };
  }

  getSymbol(): ClarityResponse<string> {
    return { ok: true, value: "RCT" };
  }

  getDecimals(): ClarityResponse<number> {
    return { ok: true, value: 6 };
  }

  getTotalSupply(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalSupply };
  }

  getBalance(account: string): ClarityResponse<number> {
    return { ok: true, value: this.state.balances.get(account) ?? 0 };
  }

  getMintRecord(id: number): ClarityResponse<MintRecord | none> {
    return { ok: true, value: this.state.mintRecords.get(id) ?? null };
  }

  isMinterCheck(account: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.minters.get(account) ?? false };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.contractPaused };
  }

  getVestingSchedule(recipient: string, id: number): ClarityResponse<VestingSchedule | none> {
    const key = `${recipient}_${id}`;
    return { ok: true, value: this.state.vestingSchedules.get(key) ?? null };
  }

  calculateClaimable(recipient: string, id: number): ClarityResponse<number> {
    const key = `${recipient}_${id}`;
    const schedule = this.state.vestingSchedules.get(key);
    if (!schedule) {
      return { ok: false, value: this.ERR_VESTING_NOT_FOUND };
    }
    const elapsed = this.state.blockHeight - schedule.start;
    const total = schedule.amount;
    const claimable = Math.floor((total * elapsed) / schedule.duration) - schedule.claimed;
    return { ok: true, value: claimable };
  }

  setAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractAdmin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.contractAdmin = newAdmin;
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractAdmin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.contractPaused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractAdmin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.contractPaused = false;
    return { ok: true, value: true };
  }

  addMinter(caller: string, minter: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractAdmin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (this.state.minters.has(minter)) {
      return { ok: false, value: this.ERR_ALREADY_REGISTERED };
    }
    this.state.minters.set(minter, true);
    return { ok: true, value: true };
  }

  removeMinter(caller: string, minter: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractAdmin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.minters.set(minter, false);
    return { ok: true, value: true };
  }

  mint(caller: string, amount: number, recipient: string, metadata: string): ClarityResponse<number> {
    if (this.state.contractPaused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.minters.get(caller)) {
      return { ok: false, value: this.ERR_INVALID_MINTER };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (recipient === "contract") { // Assuming contract principal is "contract"
      return { ok: false, value: this.ERR_INVALID_RECIPIENT };
    }
    if (metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    const currentBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, currentBalance + amount);
    this.state.totalSupply += amount;
    const mintId = this.state.totalSupply; // Use total supply as ID for simplicity
    this.state.mintRecords.set(mintId, {
      amount,
      recipient,
      metadata,
      timestamp: this.state.blockHeight,
    });
    return { ok: true, value: mintId };
  }

  mintWithVesting(caller: string, amount: number, recipient: string, duration: number, metadata: string): ClarityResponse<number> {
    if (this.state.contractPaused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.minters.get(caller)) {
      return { ok: false, value: this.ERR_INVALID_MINTER };
    }
    if (amount <= 0 || duration <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    this.state.totalSupply += amount;
    const vestingId = this.state.totalSupply;
    const key = `${recipient}_${vestingId}`;
    this.state.vestingSchedules.set(key, {
      amount,
      start: this.state.blockHeight,
      duration,
      claimed: 0,
    });
    this.state.mintRecords.set(vestingId, {
      amount,
      recipient,
      metadata,
      timestamp: this.state.blockHeight,
    });
    return { ok: true, value: vestingId };
  }

  claimVesting(caller: string, id: number): ClarityResponse<number> {
    if (this.state.contractPaused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const key = `${caller}_${id}`;
    const schedule = this.state.vestingSchedules.get(key);
    if (!schedule) {
      return { ok: false, value: this.ERR_VESTING_NOT_FOUND };
    }
    const elapsed = this.state.blockHeight - schedule.start;
    const total = schedule.amount;
    const claimable = Math.floor((total * elapsed) / schedule.duration);
    const toClaim = claimable - schedule.claimed;
    if (toClaim <= 0) {
      return { ok: false, value: this.ERR_VESTING_NOT_MATURE };
    }
    const currentBalance = this.state.balances.get(caller) ?? 0;
    this.state.balances.set(caller, currentBalance + toClaim);
    this.state.vestingSchedules.set(key, { ...schedule, claimed: claimable });
    return { ok: true, value: toClaim };
  }

  transfer(caller: string, amount: number, sender: string, recipient: string): ClarityResponse<boolean> {
    if (this.state.contractPaused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (caller !== sender) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const senderBalance = this.state.balances.get(sender) ?? 0;
    if (senderBalance < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BALANCE };
    }
    this.state.balances.set(sender, senderBalance - amount);
    const recipientBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, recipientBalance + amount);
    return { ok: true, value: true };
  }

  transferFrom(caller: string, amount: number, owner: string, recipient: string): ClarityResponse<boolean> {
    if (this.state.contractPaused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const allowanceKey = `${owner}_${caller}`;
    const allowance = this.state.allowances.get(allowanceKey) ?? 0;
    if (allowance < amount) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const ownerBalance = this.state.balances.get(owner) ?? 0;
    if (ownerBalance < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BALANCE };
    }
    this.state.balances.set(owner, ownerBalance - amount);
    const recipientBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, recipientBalance + amount);
    this.state.allowances.set(allowanceKey, allowance - amount);
    return { ok: true, value: true };
  }

  approve(caller: string, spender: string, amount: number): ClarityResponse<boolean> {
    if (this.state.contractPaused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const key = `${caller}_${spender}`;
    this.state.allowances.set(key, amount);
    return { ok: true, value: true };
  }

  getAllowance(owner: string, spender: string): ClarityResponse<number> {
    const key = `${owner}_${spender}`;
    return { ok: true, value: this.state.allowances.get(key) ?? 0 };
  }

  burn(caller: string, amount: number): ClarityResponse<boolean> {
    if (this.state.contractPaused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const balance = this.state.balances.get(caller) ?? 0;
    if (balance < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BALANCE };
    }
    this.state.balances.set(caller, balance - amount);
    this.state.totalSupply -= amount;
    return { ok: true, value: true };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  minter: "wallet_1",
  user1: "wallet_2",
  user2: "wallet_3",
  spender: "wallet_4",
};

describe("TokenManager Contract", () => {
  let contract: TokenManagerMock;

  beforeEach(() => {
    contract = new TokenManagerMock();
    // Add deployer as minter by default
    contract.addMinter(accounts.deployer, accounts.deployer);
    vi.resetAllMocks();
  });

  it("should initialize with correct token metadata", () => {
    expect(contract.getName()).toEqual({ ok: true, value: "RecycleToken" });
    expect(contract.getSymbol()).toEqual({ ok: true, value: "RCT" });
    expect(contract.getDecimals()).toEqual({ ok: true, value: 6 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 0 });
  });

  it("should allow admin to add minter", () => {
    const addMinter = contract.addMinter(accounts.deployer, accounts.minter);
    expect(addMinter).toEqual({ ok: true, value: true });

    const isMinter = contract.isMinterCheck(accounts.minter);
    expect(isMinter).toEqual({ ok: true, value: true });
  });

  it("should prevent non-admin from adding minter", () => {
    const addMinter = contract.addMinter(accounts.user1, accounts.minter);
    expect(addMinter).toEqual({ ok: false, value: 100 });
  });

  it("should allow minter to mint tokens with metadata", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    
    const mintResult = contract.mint(
      accounts.minter,
      1000000, // 1 token with 6 decimals
      accounts.user1,
      "Reward for recycling 10kg plastic"
    );
    expect(mintResult.ok).toBe(true);
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 1000000 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 1000000 });

    const mintId = mintResult.value as number;
    const mintRecord = contract.getMintRecord(mintId);
    expect(mintRecord).toEqual({
      ok: true,
      value: expect.objectContaining({
        amount: 1000000,
        recipient: accounts.user1,
        metadata: "Reward for recycling 10kg plastic",
      }),
    });
  });

  it("should prevent non-minter from minting", () => {
    const mintResult = contract.mint(
      accounts.user1,
      1000000,
      accounts.user1,
      "Unauthorized mint"
    );
    expect(mintResult).toEqual({ ok: false, value: 104 });
  });

  it("should prevent metadata exceeding max length", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    
    const longMetadata = "a".repeat(501);
    const mintResult = contract.mint(
      accounts.minter,
      1000000,
      accounts.user1,
      longMetadata
    );
    expect(mintResult).toEqual({ ok: false, value: 106 });
  });

  it("should allow minting with vesting and claiming over time", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    
    const mintResult = contract.mintWithVesting(
      accounts.minter,
      1000000,
      accounts.user1,
      100, // 100 blocks duration
      "Vested reward"
    );
    expect(mintResult.ok).toBe(true);
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 1000000 });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 0 }); // Not claimed yet

    const vestingId = mintResult.value as number;

    // Try claim immediately
    let claimResult = contract.claimVesting(accounts.user1, vestingId);
    expect(claimResult).toEqual({ ok: false, value: 109 }); // Not mature

    // Advance 50 blocks
    contract.advanceBlockHeight(50);

    claimResult = contract.claimVesting(accounts.user1, vestingId);
    expect(claimResult).toEqual({ ok: true, value: 500000 }); // Half claimed
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 500000 });

    // Advance another 50 blocks
    contract.advanceBlockHeight(50);

    claimResult = contract.claimVesting(accounts.user1, vestingId);
    expect(claimResult).toEqual({ ok: true, value: 500000 }); // Remaining half
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 1000000 });
  });

  it("should allow token transfer", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000000, accounts.user1, "Test mint");

    const transferResult = contract.transfer(
      accounts.user1,
      500000,
      accounts.user1,
      accounts.user2
    );
    expect(transferResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 500000 });
    expect(contract.getBalance(accounts.user2)).toEqual({ ok: true, value: 500000 });
  });

  it("should prevent transfer of insufficient balance", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000000, accounts.user1, "Test mint");

    const transferResult = contract.transfer(
      accounts.user1,
      2000000,
      accounts.user1,
      accounts.user2
    );
    expect(transferResult).toEqual({ ok: false, value: 107 });
  });

  it("should allow approved transfer-from", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000000, accounts.user1, "Test mint");

    const approveResult = contract.approve(accounts.user1, accounts.spender, 600000);
    expect(approveResult).toEqual({ ok: true, value: true });
    expect(contract.getAllowance(accounts.user1, accounts.spender)).toEqual({ ok: true, value: 600000 });

    const transferFromResult = contract.transferFrom(
      accounts.spender,
      500000,
      accounts.user1,
      accounts.user2
    );
    expect(transferFromResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 500000 });
    expect(contract.getBalance(accounts.user2)).toEqual({ ok: true, value: 500000 });
    expect(contract.getAllowance(accounts.user1, accounts.spender)).toEqual({ ok: true, value: 100000 });
  });

  it("should allow burning tokens", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000000, accounts.user1, "Test mint");

    const burnResult = contract.burn(accounts.user1, 300000);
    expect(burnResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 700000 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 700000 });
  });

  it("should pause and unpause contract", () => {
    const pauseResult = contract.pauseContract(accounts.deployer);
    expect(pauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });

    const mintDuringPause = contract.mint(
      accounts.deployer,
      1000000,
      accounts.user1,
      "Paused mint"
    );
    expect(mintDuringPause).toEqual({ ok: false, value: 101 });

    const unpauseResult = contract.unpauseContract(accounts.deployer);
    expect(unpauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });
});