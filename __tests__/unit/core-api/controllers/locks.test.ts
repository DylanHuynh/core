import "jest-extended";

import Hapi from "@hapi/hapi";
import { Application, Contracts } from "@packages/core-kernel";
import { buildSenderWallet, initApp, ItemResponse, PaginatedResponse } from "../__support__";
import { LocksController } from "@packages/core-api/src/controllers/locks";
import { BlockchainMocks, StateStoreMocks, TransactionRepositoryMocks } from "../mocks";
import { Wallets } from "@packages/core-state";
import { Identifiers } from "@packages/core-kernel/src/ioc";
import { Crypto, Enums, Identities, Interfaces, Transactions, Utils } from "@packages/crypto";
import { TransactionHandlerRegistry } from "@packages/core-transactions/src/handlers/handler-registry";
import { Transactions as MagistrateTransactions } from "@packages/core-magistrate-crypto";
import { BuilderFactory } from "@packages/crypto/src/transactions";
import { htlcSecretHashHex } from "../../core-transactions/handlers/__fixtures__/htlc-secrets";
import passphrases from "@packages/core-test-framework/src/internal/passphrases.json";

let app: Application;
let controller: LocksController;
let walletRepository: Wallets.WalletRepository;

const mockLastBlockData: Partial<Interfaces.IBlockData> = { timestamp: Crypto.Slots.getTime(), height: 4 };

const { EpochTimestamp } = Enums.HtlcLockExpirationType;

const makeBlockHeightTimestamp = (heightRelativeToLastBlock = 2) =>
    mockLastBlockData.height! + heightRelativeToLastBlock;
const makeNotExpiredTimestamp = type =>
    type === EpochTimestamp ? mockLastBlockData.timestamp! + 999 : makeBlockHeightTimestamp(9);

beforeEach(() => {
    app = initApp();

    // Triggers registration of indexes
    app.get<TransactionHandlerRegistry>(Identifiers.TransactionHandlerRegistry);

    controller = app.resolve<LocksController>(LocksController);
    walletRepository = app.get<Wallets.WalletRepository>(Identifiers.WalletRepository);

    StateStoreMocks.setMockBlock({ data: mockLastBlockData } as Interfaces.IBlock)
});

afterEach(() => {
    try {
        Transactions.TransactionRegistry.deregisterTransactionType(
            MagistrateTransactions.BusinessRegistrationTransaction,
        );
        Transactions.TransactionRegistry.deregisterTransactionType(
            MagistrateTransactions.BridgechainRegistrationTransaction,
        );
    } catch {}
});

describe("LocksController", () => {
    let lockWallet: Contracts.State.Wallet;
    let htlcLockTransaction: Interfaces.ITransaction;

    beforeEach(() => {
        lockWallet = buildSenderWallet(app);

        const expiration = {
            type: EpochTimestamp,
            value: makeNotExpiredTimestamp(EpochTimestamp),
        };

        htlcLockTransaction = BuilderFactory.htlcLock()
            .htlcLockAsset({
                secretHash: htlcSecretHashHex,
                expiration: expiration,
            })
            .recipientId(Identities.Address.fromPassphrase(passphrases[1]))
            .amount("1")
            .nonce("1")
            .sign(passphrases[0])
            .build();

        lockWallet.setAttribute("htlc.lockedBalance", Utils.BigNumber.make("1"));

        lockWallet.setAttribute("htlc.locks", {
            [htlcLockTransaction.id!]: {
                amount: htlcLockTransaction.data.amount,
                recipientId: htlcLockTransaction.data.recipientId,
                timestamp: mockLastBlockData.timestamp,
                ...htlcLockTransaction.data.asset!.lock,
            },
        });

        walletRepository.index(lockWallet);
    });

    describe("index", () => {
        it("should return list of delegates", async () => {
            let request: Hapi.Request = {
                query: {
                    page: 1,
                    limit: 100,
                    transform: false
                }
            };

            let response = <PaginatedResponse>(await controller.index(request, undefined));

            expect(response.totalCount).toBeDefined();
            expect(response.meta).toBeDefined();
            expect(response.results).toBeDefined();
            expect(response.results[0]).toEqual(expect.objectContaining(
                {
                    lockId: htlcLockTransaction.id,
                }
            ));
        });
    });

    describe("show", () => {
        it("should return lock", async () => {
            let request: Hapi.Request = {
                params: {
                    id: htlcLockTransaction.id,
                }
            };

            let response = <ItemResponse>(await controller.show(request, undefined));

            expect(response.data).toEqual(expect.objectContaining(
                {
                    lockId: htlcLockTransaction.id,
                }
            ));
        });

        it("should return error if lock does not exists", async () => {
            let request: Hapi.Request = {
                params: {
                    id: "non_existing_lock_id"
                }
            };

            await expect(controller.show(request, undefined)).resolves.toThrowError("Lock not found");
        });
    });

    describe("search", () => {
        it("should return list of locks", async () => {
            let request: Hapi.Request = {
                params: {
                    id: htlcLockTransaction.id
                },
                query: {
                    page: 1,
                    limit: 100,
                    transform: false
                }
            };

            let response = <PaginatedResponse>(await controller.search(request, undefined));

            expect(response.totalCount).toBeDefined();
            expect(response.meta).toBeDefined();
            expect(response.results).toBeDefined();
            expect(response.results[0]).toEqual(expect.objectContaining(
                {
                    lockId: htlcLockTransaction.id,
                }
            ));
        });
    });

    describe("unlocked", () => {
        it("should return list of locks", async () => {
            // TODO: From fixtures
            let mockBlock = {
                id: "17184958558311101492",
                reward: Utils.BigNumber.make("100"),
                totalFee: Utils.BigNumber.make("200"),
                totalAmount: Utils.BigNumber.make("300"),
            };

            BlockchainMocks.setMockBlock({data: mockBlock} as Partial<Interfaces.IBlock>);
            TransactionRepositoryMocks.setMockTransactions([htlcLockTransaction]);

            let request: Hapi.Request = {
                payload: {
                    ids: [htlcLockTransaction.id]
                },
            };

            let response = <PaginatedResponse>(await controller.unlocked(request, undefined));

            expect(response.totalCount).toBeDefined();
            expect(response.meta).toBeDefined();
            expect(response.results).toBeDefined();
            expect(response.results[0]).toEqual(expect.objectContaining(
                {
                    id: htlcLockTransaction.id,
                }
            ));
        });
    });
});