import { rpc, xdr, nativeToScVal, Address, Keypair, Networks } from "@stellar/stellar-sdk";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";
import { ClientOptions } from "./types";
import { ContractExecutionError, ContractErrorCode } from "../errors";
import {
  assertValidDelegatedApproverAssignment,
  buildDelegatedApproverAssignmentRequest,
  type DelegatedApproverAssignmentRequest,
} from "../authorization/delegatedApprover";

/** Response for a successful delegated approver assignment. */
export interface AssignDelegatedApproverResponse {
  /** Id of the assignment that was created. */
  assignmentId: string;
  /** The delegated approver's address. */
  delegatedApprover: string;
  /** The original approver's address. */
  originalApprover: string;
  /** Effective start timestamp (epoch ms). */
  effectiveFrom: number;
  /** Effective end timestamp (epoch ms). */
  effectiveUntil: number;
  /** The payroll workflow/batch this assignment applies to. */
  workflowId: string;
  /** Current state of the assignment. */
  state: "active" | "pending" | "expired" | "revoked";
}

/**
 * Typed client for delegated approver assignment contract methods.
 *
 * Assumes the contract exposes:
 * - `assign_delegated_approver(assignment_id, original_approver, delegated_approver, workflow_id, effective_from, effective_until)` → assignment struct
 * - `get_delegated_approver_assignment(assignment_id)` → assignment struct
 * - `revoke_delegated_approver_assignment(assignment_id, revoked_by)` → void
 *
 * Assignment validation runs locally before any network call: invalid
 * inputs throw a {@link DelegatedApproverAssignmentError} without
 * broadcasting a transaction.
 */
export class DelegatedApproverClient extends BaseContractWrapper {
  private readonly networkPassphrase: string;

  constructor(server: rpc.Server, contractId: string, options?: ClientOptions) {
    super(server, contractId);
    this.networkPassphrase = options?.networkPassphrase ?? Networks.TESTNET;
  }

  /**
   * Assigns a delegated approver for a payroll workflow.
   *
   * Validation runs locally before any network call: a missing/malformed
   * `originalApprover`, `delegatedApprover`, `workflowId`, or date range
   * throws a {@link DelegatedApproverAssignmentError} without broadcasting
   * a transaction and without echoing sensitive values into the error context.
   *
   * @param request  - Assignment request (original approver, delegated approver, workflow, date range).
   * @param signer   - Keypair or ISigner to sign the assignment transaction.
   * @param network  - Optional network passphrase override.
   * @returns The created assignment details.
   * @throws {DelegatedApproverAssignmentError} When assignment inputs are invalid.
   * @throws {ContractExecutionError} When the contract call fails.
   */
  async assignDelegatedApprover(
    request: DelegatedApproverAssignmentRequest,
    signer: Keypair | import("../signer/types").ISigner,
    network?: string
  ): Promise<AssignDelegatedApproverResponse> {
    // Local, pre-flight validation. Fails fast and never surfaces sensitive
    // values in the thrown error.
    assertValidDelegatedApproverAssignment(request);
    const normalized = buildDelegatedApproverAssignmentRequest(request);

    const args: xdr.ScVal[] = [
      nativeToScVal(normalized.assignmentId, { type: "string" }),
      new Address(normalized.originalApprover).toScVal(),
      new Address(normalized.delegatedApprover).toScVal(),
      nativeToScVal(normalized.workflowId, { type: "string" }),
      nativeToScVal(normalized.effectiveFrom, { type: "u64" }),
      nativeToScVal(normalized.effectiveUntil, { type: "u64" }),
    ];

    const result = await this.invoke(
      "assign_delegated_approver",
      args,
      signer,
      network ?? this.networkPassphrase
    );

    return this.decodeAssignment(result);
  }

  /**
   * Fetches an existing delegated approver assignment.
   *
   * @param assignmentId - Id of the assignment to query.
   * @param signer       - Keypair or ISigner to sign the contract query.
   * @param network      - Optional network passphrase override.
   * @returns The assignment details.
   * @throws {ContractExecutionError} When the query fails or the response cannot be decoded.
   */
  async getDelegatedApproverAssignment(
    assignmentId: string,
    signer: Keypair | import("../signer/types").ISigner,
    network?: string
  ): Promise<AssignDelegatedApproverResponse> {
    if (typeof assignmentId !== "string" || assignmentId.trim() === "") {
      throw new ContractExecutionError(
        "assignmentId is required to query a delegated approver assignment.",
        ContractErrorCode.INVALID_RESPONSE,
        {}
      );
    }

    const args: xdr.ScVal[] = [nativeToScVal(assignmentId, { type: "string" })];
    const result = await this.invoke(
      "get_delegated_approver_assignment",
      args,
      signer,
      network ?? this.networkPassphrase
    );

    return this.decodeAssignment(result);
  }

  /**
   * Revokes a delegated approver assignment.
   *
   * @param assignmentId - Id of the assignment to revoke.
   * @param revokedBy    - Address of the party revoking the assignment.
   * @param signer       - Keypair or ISigner to sign the revocation transaction.
   * @param network      - Optional network passphrase override.
   * @throws {ContractExecutionError} When the contract call fails.
   */
  async revokeDelegatedApproverAssignment(
    assignmentId: string,
    revokedBy: string,
    signer: Keypair | import("../signer/types").ISigner,
    network?: string
  ): Promise<void> {
    if (typeof assignmentId !== "string" || assignmentId.trim() === "") {
      throw new ContractExecutionError(
        "assignmentId is required to revoke a delegated approver assignment.",
        ContractErrorCode.INVALID_RESPONSE,
        {}
      );
    }

    if (typeof revokedBy !== "string" || revokedBy.trim() === "") {
      throw new ContractExecutionError(
        "revokedBy address is required to revoke a delegated approver assignment.",
        ContractErrorCode.INVALID_RESPONSE,
        {}
      );
    }

    const args: xdr.ScVal[] = [
      nativeToScVal(assignmentId, { type: "string" }),
      new Address(revokedBy).toScVal(),
    ];

    await this.invoke(
      "revoke_delegated_approver_assignment",
      args,
      signer,
      network ?? this.networkPassphrase
    );
  }

  /**
   * Decodes a contract assignment response into a typed response object.
   */
  private decodeAssignment(scVal: xdr.ScVal): AssignDelegatedApproverResponse {
    let map;
    try {
      map = scVal.map();
    } catch {
      map = null;
    }
    if (!map) {
      throw new ContractExecutionError(
        "Failed to decode delegated approver assignment response: expected a struct (ScMap). The contract may have returned an unexpected shape or the RPC node is out of sync.",
        ContractErrorCode.INVALID_RESPONSE,
        {}
      );
    }

    const entries: Record<string, xdr.ScVal> = {};
    for (const entry of map) {
      const key = entry.key().sym()?.toString() ?? "";
      if (!key) continue;
      entries[key] = entry.val();
    }

    return {
      assignmentId: this.scValToString(entries.assignment_id) ?? "",
      delegatedApprover: Address.fromScVal(entries.delegated_approver).toString(),
      originalApprover: Address.fromScVal(entries.original_approver).toString(),
      workflowId: this.scValToString(entries.workflow_id) ?? "",
      effectiveFrom: Number(this.scValToBigInt(entries.effective_from)),
      effectiveUntil: Number(this.scValToBigInt(entries.effective_until)),
      state: this.decodeState(entries.state),
    };
  }

  private scValToString(scVal: xdr.ScVal | undefined): string | null {
    if (!scVal) return null;
    try {
      return scVal.str()?.toString() ?? null;
    } catch {
      return null;
    }
  }

  private scValToBigInt(scVal: xdr.ScVal | undefined): bigint {
    if (!scVal) return 0n;
    try {
      const u64 = scVal.u64();
      if (u64) {
        return BigInt((u64 as unknown as { toString: () => string }).toString());
      }
    } catch {}
    try {
      const i64 = scVal.i64();
      if (i64) {
        return BigInt((i64 as unknown as { toString: () => string }).toString());
      }
    } catch {}
    try {
      const u128 = scVal.u128();
      if (u128) {
        const hi = BigInt((u128.hi() as unknown as { toString: () => string }).toString());
        const lo = BigInt((u128.lo() as unknown as { toString: () => string }).toString());
        return (hi << 64n) | lo;
      }
    } catch {}
    return 0n;
  }

  private decodeState(scVal: xdr.ScVal | undefined): "active" | "pending" | "expired" | "revoked" {
    if (!scVal) return "pending";
    try {
      const sym = scVal.sym()?.toString() ?? "";
      switch (sym) {
        case "active":
          return "active";
        case "pending":
          return "pending";
        case "expired":
          return "expired";
        case "revoked":
          return "revoked";
        default:
          return "pending";
      }
    } catch {
      return "pending";
    }
  }
}
