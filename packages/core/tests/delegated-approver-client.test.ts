import {
  DelegatedApproverClient,
  AssignDelegatedApproverResponse,
} from "../src/clients/DelegatedApproverClient";
import {
  assertValidDelegatedApproverAssignment,
  buildDelegatedApproverAssignmentRequest,
  tryValidateDelegatedApproverAssignment,
  DelegatedApproverAssignmentError,
  DelegatedApproverAssignmentErrorCode,
  DelegatedApproverAssignmentRequest,
  isDelegatedApproverActive,
  getDelegatedApproverExpiryState,
  formatDelegatedApproverExpiry,
} from "../src/authorization/delegatedApprover";
import { ContractExecutionError, ContractErrorCode } from "../src/errors";
import { rpc, xdr, Keypair, Networks, Address } from "@stellar/stellar-sdk";

// Valid Stellar test addresses (generated with Keypair.random())
const VALID_ORIGINAL_APPROVER = "GAZATQHSGNV4JDAX6NIE5JNLOLLQBJZC27BSJ6EUXN4JR7FUEJ6DG27B";
const VALID_DELEGATED_APPROVER = "GDS5KF5DIWBNDH7B4VP6GT6MMKT6DCMGBYUNJZOE3EXM56AV2SG4KPN5";
const VALID_CONTRACT_ID = "CABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234567890123456789012";

// Mock the BaseContractWrapper invoke method
jest.mock("../src/adapters/BaseContractWrapper", () => {
  return {
    BaseContractWrapper: class MockBaseContractWrapper {
      protected server: rpc.Server;
      protected contractId: string;

      constructor(server: rpc.Server, contractId: string) {
        this.server = server;
        this.contractId = contractId;
      }

      async invoke(
        method: string,
        args: xdr.ScVal[],
        signer: Keypair,
        network?: string
      ): Promise<xdr.ScVal> {
        // Return a mock successful response
        if (
          method === "assign_delegated_approver" ||
          method === "get_delegated_approver_assignment"
        ) {
          const mapEntries = [
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("assignment_id"),
              val: xdr.ScVal.scvString("del_appr_test123"),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("delegated_approver"),
              val: new Address(VALID_DELEGATED_APPROVER).toScVal(),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("original_approver"),
              val: new Address(VALID_ORIGINAL_APPROVER).toScVal(),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("workflow_id"),
              val: xdr.ScVal.scvString("workflow_001"),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("effective_from"),
              val: xdr.ScVal.scvU64(xdr.Uint64.fromString("1700000000000")),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("effective_until"),
              val: xdr.ScVal.scvU64(xdr.Uint64.fromString("1702592000000")),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("state"),
              val: xdr.ScVal.scvSymbol("active"),
            }),
          ];
          return xdr.ScVal.scvMap(mapEntries);
        }
        return xdr.ScVal.scvVoid();
      }
    },
  };
});

describe("DelegatedApproverClient", () => {
  let client: DelegatedApproverClient;
  let mockServer: jest.Mocked<rpc.Server>;
  let mockSigner: Keypair;

  beforeEach(() => {
    mockServer = {
      getAccount: jest.fn(),
      simulateTransaction: jest.fn(),
      sendTransaction: jest.fn(),
      getTransaction: jest.fn(),
    } as any;

    mockSigner = Keypair.random();
    client = new DelegatedApproverClient(mockServer, VALID_CONTRACT_ID);
  });

  describe("assignDelegatedApprover", () => {
    const validRequest: DelegatedApproverAssignmentRequest = {
      originalApprover: VALID_ORIGINAL_APPROVER,
      delegatedApprover: VALID_DELEGATED_APPROVER,
      workflowId: "workflow_001",
      effectiveFrom: Date.now() + 1000,
      effectiveUntil: Date.now() + 86400000,
    };

    it("should successfully assign a delegated approver", async () => {
      const result = await client.assignDelegatedApprover(validRequest, mockSigner);

      expect(result).toBeDefined();
      expect(result.assignmentId).toBe("del_appr_test123");
      expect(result.delegatedApprover).toBe(VALID_DELEGATED_APPROVER);
      expect(result.originalApprover).toBe(VALID_ORIGINAL_APPROVER);
      expect(result.workflowId).toBe("workflow_001");
      expect(result.state).toBe("active");
    });

    it("should throw ContractExecutionError for empty assignmentId on get", async () => {
      await expect(client.getDelegatedApproverAssignment("", mockSigner)).rejects.toThrow(
        ContractExecutionError
      );
    });

    it("should throw ContractExecutionError for empty revokedBy on revoke", async () => {
      await expect(
        client.revokeDelegatedApproverAssignment("assignment_123", "", mockSigner)
      ).rejects.toThrow(ContractExecutionError);
    });
  });

  describe("getDelegatedApproverAssignment", () => {
    it("should fetch an existing assignment", async () => {
      const result = await client.getDelegatedApproverAssignment("del_appr_test123", mockSigner);

      expect(result).toBeDefined();
      expect(result.assignmentId).toBe("del_appr_test123");
      expect(result.state).toBe("active");
    });
  });

  describe("revokeDelegatedApproverAssignment", () => {
    it("should revoke an assignment", async () => {
      await expect(
        client.revokeDelegatedApproverAssignment(
          "del_appr_test123",
          VALID_ORIGINAL_APPROVER,
          mockSigner
        )
      ).resolves.toBeUndefined();
    });
  });
});

describe("Delegated Approver Assignment Validation", () => {
  const now = Date.now();
  const tomorrow = now + 86400000;
  const nextWeek = now + 7 * 86400000;

  const validBaseRequest: DelegatedApproverAssignmentRequest = {
    originalApprover: VALID_ORIGINAL_APPROVER,
    delegatedApprover: VALID_DELEGATED_APPROVER,
    workflowId: "workflow_001",
    effectiveFrom: tomorrow,
    effectiveUntil: nextWeek,
  };

  describe("assertValidDelegatedApproverAssignment", () => {
    it("should pass for a valid request", () => {
      expect(() => assertValidDelegatedApproverAssignment(validBaseRequest)).not.toThrow();
    });

    it("should throw MISSING_FIELD for missing originalApprover", () => {
      const request = { ...validBaseRequest, originalApprover: "" };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
      try {
        assertValidDelegatedApproverAssignment(request);
      } catch (err) {
        expect(err).toBeInstanceOf(DelegatedApproverAssignmentError);
        expect((err as DelegatedApproverAssignmentError).code).toBe(
          DelegatedApproverAssignmentErrorCode.MISSING_FIELD
        );
      }
    });

    it("should throw MISSING_FIELD for missing delegatedApprover", () => {
      const request = { ...validBaseRequest, delegatedApprover: "" };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
    });

    it("should throw MISSING_FIELD for missing workflowId", () => {
      const request = { ...validBaseRequest, workflowId: "" };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
    });

    it("should throw MISSING_FIELD for missing effectiveFrom", () => {
      const request = { ...validBaseRequest, effectiveFrom: NaN };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
    });

    it("should throw MISSING_FIELD for missing effectiveUntil", () => {
      const request = { ...validBaseRequest, effectiveUntil: NaN };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
    });

    it("should throw INVALID_ORIGINAL_APPROVER for invalid address format", () => {
      const request = { ...validBaseRequest, originalApprover: "invalid_address" };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
      try {
        assertValidDelegatedApproverAssignment(request);
      } catch (err) {
        expect((err as DelegatedApproverAssignmentError).code).toBe(
          DelegatedApproverAssignmentErrorCode.INVALID_ORIGINAL_APPROVER
        );
      }
    });

    it("should throw INVALID_DELEGATED_APPROVER for invalid address format", () => {
      const request = { ...validBaseRequest, delegatedApprover: "invalid_address" };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
      try {
        assertValidDelegatedApproverAssignment(request);
      } catch (err) {
        expect((err as DelegatedApproverAssignmentError).code).toBe(
          DelegatedApproverAssignmentErrorCode.INVALID_DELEGATED_APPROVER
        );
      }
    });

    it("should throw SAME_APPROVER_ADDRESSES when addresses are identical", () => {
      const request = { ...validBaseRequest, delegatedApprover: VALID_ORIGINAL_APPROVER };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
      try {
        assertValidDelegatedApproverAssignment(request);
      } catch (err) {
        expect((err as DelegatedApproverAssignmentError).code).toBe(
          DelegatedApproverAssignmentErrorCode.SAME_APPROVER_ADDRESSES
        );
      }
    });

    it("should throw INVALID_WORKFLOW_ID for empty workflowId", () => {
      const request = { ...validBaseRequest, workflowId: "   " };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
      try {
        assertValidDelegatedApproverAssignment(request);
      } catch (err) {
        expect((err as DelegatedApproverAssignmentError).code).toBe(
          DelegatedApproverAssignmentErrorCode.INVALID_WORKFLOW_ID
        );
      }
    });

    it("should throw INVALID_DATE_RANGE when effectiveFrom >= effectiveUntil", () => {
      const request = { ...validBaseRequest, effectiveFrom: nextWeek, effectiveUntil: tomorrow };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
      try {
        assertValidDelegatedApproverAssignment(request);
      } catch (err) {
        expect((err as DelegatedApproverAssignmentError).code).toBe(
          DelegatedApproverAssignmentErrorCode.INVALID_DATE_RANGE
        );
      }
    });

    it("should throw EFFECTIVE_FROM_TOO_OLD when effectiveFrom is too far in the past", () => {
      const request = { ...validBaseRequest, effectiveFrom: now - 2 * 86400000 };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
      try {
        assertValidDelegatedApproverAssignment(request);
      } catch (err) {
        expect((err as DelegatedApproverAssignmentError).code).toBe(
          DelegatedApproverAssignmentErrorCode.EFFECTIVE_FROM_TOO_OLD
        );
      }
    });

    it("should throw EFFECTIVE_UNTIL_TOO_FAR when effectiveUntil is too far in the future", () => {
      const request = { ...validBaseRequest, effectiveUntil: now + 100 * 86400000 };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
      try {
        assertValidDelegatedApproverAssignment(request);
      } catch (err) {
        expect((err as DelegatedApproverAssignmentError).code).toBe(
          DelegatedApproverAssignmentErrorCode.EFFECTIVE_UNTIL_TOO_FAR
        );
      }
    });

    it("should throw DURATION_EXCEEDS_MAXIMUM when duration exceeds 30 days", () => {
      const request = {
        ...validBaseRequest,
        effectiveFrom: now,
        effectiveUntil: now + 31 * 86400000,
      };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
      try {
        assertValidDelegatedApproverAssignment(request);
      } catch (err) {
        expect((err as DelegatedApproverAssignmentError).code).toBe(
          DelegatedApproverAssignmentErrorCode.DURATION_EXCEEDS_MAXIMUM
        );
      }
    });

    it("should throw ORIGINAL_ROLE_CANNOT_DELEGATE for unauthorized role", () => {
      const request = { ...validBaseRequest, originalApproverRole: "emergency_approver" as any };
      expect(() => assertValidDelegatedApproverAssignment(request)).toThrow(
        DelegatedApproverAssignmentError
      );
      try {
        assertValidDelegatedApproverAssignment(request);
      } catch (err) {
        expect((err as DelegatedApproverAssignmentError).code).toBe(
          DelegatedApproverAssignmentErrorCode.ORIGINAL_ROLE_CANNOT_DELEGATE
        );
      }
    });

    it("should pass for authorized roles", () => {
      const authorizedRoles = [
        "payroll_admin",
        "treasury_operator",
        "compliance_reviewer",
      ] as const;
      for (const role of authorizedRoles) {
        const request = { ...validBaseRequest, originalApproverRole: role };
        expect(() => assertValidDelegatedApproverAssignment(request)).not.toThrow();
      }
    });
  });

  describe("buildDelegatedApproverAssignmentRequest", () => {
    it("should generate assignmentId when not provided", () => {
      const result = buildDelegatedApproverAssignmentRequest(validBaseRequest);
      expect(result.assignmentId).toMatch(/^del_appr_\d+_[a-z0-9]+$/);
    });

    it("should use provided assignmentId", () => {
      const request = { ...validBaseRequest, assignmentId: "custom_id_123" };
      const result = buildDelegatedApproverAssignmentRequest(request);
      expect(result.assignmentId).toBe("custom_id_123");
    });

    it("should trim whitespace from string fields", () => {
      const request = {
        ...validBaseRequest,
        originalApprover: `  ${VALID_ORIGINAL_APPROVER}  `,
        delegatedApprover: `  ${VALID_DELEGATED_APPROVER}  `,
        workflowId: "  workflow_001  ",
      };
      const result = buildDelegatedApproverAssignmentRequest(request);
      expect(result.originalApprover).toBe(VALID_ORIGINAL_APPROVER);
      expect(result.delegatedApprover).toBe(VALID_DELEGATED_APPROVER);
      expect(result.workflowId).toBe("workflow_001");
    });
  });

  describe("tryValidateDelegatedApproverAssignment", () => {
    it("should return ok: true for valid request", () => {
      const result = tryValidateDelegatedApproverAssignment(validBaseRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.assignmentId).toBeDefined();
      }
    });

    it("should return ok: false with error for invalid request", () => {
      const request = { ...validBaseRequest, originalApprover: "" };
      const result = tryValidateDelegatedApproverAssignment(request);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(DelegatedApproverAssignmentError);
        expect(result.error.code).toBe(DelegatedApproverAssignmentErrorCode.MISSING_FIELD);
      }
    });
  });
});

describe("Delegated Approver Expiry Helpers", () => {
  // Use a 7-day assignment so that 1 hour after start is well outside the 24h expiring-soon threshold
  const now = 1700000000000;
  const assignment = {
    assignmentId: "test_123",
    originalApprover: VALID_ORIGINAL_APPROVER,
    delegatedApprover: VALID_DELEGATED_APPROVER,
    workflowId: "workflow_001",
    effectiveFrom: now,
    effectiveUntil: now + 7 * 86400000, // 7 days
    originalApproverRole: "payroll_admin" as const,
  };

  describe("isDelegatedApproverActive", () => {
    it("should return true when assignment is active", () => {
      expect(isDelegatedApproverActive(assignment, now + 3600000)).toBe(true);
    });

    it("should return false when assignment has not started", () => {
      expect(isDelegatedApproverActive(assignment, now - 3600000)).toBe(false);
    });

    it("should return false when assignment has expired", () => {
      expect(isDelegatedApproverActive(assignment, now + 8 * 86400000)).toBe(false);
    });

    it("should return false exactly at expiry time", () => {
      expect(isDelegatedApproverActive(assignment, assignment.effectiveUntil)).toBe(false);
    });

    it("should return true exactly at start time", () => {
      expect(isDelegatedApproverActive(assignment, assignment.effectiveFrom)).toBe(true);
    });
  });

  describe("getDelegatedApproverExpiryState", () => {
    it("should return not_yet_active before effectiveFrom", () => {
      expect(getDelegatedApproverExpiryState(assignment, now - 3600000)).toBe("not_yet_active");
    });

    it("should return active during valid period", () => {
      expect(getDelegatedApproverExpiryState(assignment, now + 3600000)).toBe("active");
    });

    it("should return expiring_soon within threshold of expiry", () => {
      const expiringSoon = assignment.effectiveUntil - 3600000; // 1 hour before expiry
      expect(getDelegatedApproverExpiryState(assignment, expiringSoon)).toBe("expiring_soon");
    });

    it("should return expired after effectiveUntil", () => {
      expect(getDelegatedApproverExpiryState(assignment, assignment.effectiveUntil + 1000)).toBe(
        "expired"
      );
    });
  });

  describe("formatDelegatedApproverExpiry", () => {
    it("should format active state correctly", () => {
      const result = formatDelegatedApproverExpiry(assignment, now + 3600000);
      expect(result.state).toBe("active");
      expect(result.label).toBe("Active");
      expect(result.variant).toBe("success");
      expect(result.remainingMs).toBeDefined();
    });

    it("should format expiring_soon state correctly", () => {
      const result = formatDelegatedApproverExpiry(assignment, assignment.effectiveUntil - 3600000);
      expect(result.state).toBe("expiring_soon");
      expect(result.label).toBe("Expiring Soon");
      expect(result.variant).toBe("warning");
    });

    it("should format expired state correctly", () => {
      const result = formatDelegatedApproverExpiry(assignment, assignment.effectiveUntil + 1000);
      expect(result.state).toBe("expired");
      expect(result.label).toBe("Expired");
      expect(result.variant).toBe("danger");
    });

    it("should format not_yet_active state correctly", () => {
      const result = formatDelegatedApproverExpiry(assignment, now - 3600000);
      expect(result.state).toBe("not_yet_active");
      expect(result.label).toBe("Not Yet Active");
      expect(result.variant).toBe("info");
    });
  });
});

describe("Delegated Approver Assignment - Sensitive Data Safety", () => {
  const baseRequest = {
    originalApprover: VALID_ORIGINAL_APPROVER,
    delegatedApprover: VALID_DELEGATED_APPROVER,
    workflowId: "workflow_001",
    effectiveFrom: Date.now() + 1000,
    effectiveUntil: Date.now() + 86400000,
  };

  it("should not expose sensitive values in error messages", () => {
    // The validation should not include salary amounts, payroll records,
    // or employee financial data in error messages
    try {
      assertValidDelegatedApproverAssignment({ ...baseRequest, originalApprover: "" });
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toMatch(/salary|amount|payroll|employee|financial/i);
    }
  });

  it("should not include full request bodies in errors", () => {
    try {
      assertValidDelegatedApproverAssignment({ ...baseRequest, workflowId: "" });
    } catch (err) {
      const error = err as DelegatedApproverAssignmentError;
      // Context should only contain field names, not sensitive values
      expect(error.context).not.toHaveProperty("salary");
      expect(error.context).not.toHaveProperty("amount");
      expect(error.context).not.toHaveProperty("employeeId");
    }
  });
});
