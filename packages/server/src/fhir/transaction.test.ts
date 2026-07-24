// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { WithId } from '@medplum/core';
import { OperationOutcomeError, Operator, conflict, notFound, parseSearchRequest, sleep } from '@medplum/core';
import type { Patient, Project } from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { initAppServices, shutdownApp } from '../app';
import { loadTestConfig } from '../config/loader';
import { r4ProjectId } from '../constants';
import { DatabaseMode, getDatabasePool } from '../database';
import { getLogger } from '../logger';
import { createTestProject, withTestContext } from '../test.setup';
import * as workersModule from '../workers';
import type { SystemRepository } from './repo';
import { getShardSystemRepo, Repository } from './repo';
import { PostgresError } from './sql';

describe('FHIR Repo Transactions', () => {
  let repo: Repository;
  let systemRepo: SystemRepository;

  beforeAll(async () => {
    const config = await loadTestConfig();
    await initAppServices(config);

    repo = (await createTestProject({ withRepo: true })).repo;
    systemRepo = repo.getSystemRepo();
  });

  afterAll(async () => {
    await shutdownApp();
  });

  test('Transaction commit', () =>
    withTestContext(async () => {
      let patient: Patient | undefined;
      await repo.withTransaction(async () => {
        patient = await repo.createResource<Patient>({ resourceType: 'Patient' });
        expect(patient).toBeDefined();
      });
      expect(patient).toBeDefined();

      // Read the patient by ID
      // This should succeed
      const readCheck1 = await repo.readResource('Patient', patient?.id as string);
      expect(readCheck1).toBeDefined();

      // Search for patient by ID
      // This should succeed
      const searchCheck1 = await repo.search<Patient>({
        resourceType: 'Patient',
        filters: [{ code: '_id', operator: Operator.EQUALS, value: patient?.id as string }],
      });
      expect(searchCheck1.entry).toHaveLength(1);
    }));

  test('Transaction rollback', () =>
    withTestContext(async () => {
      let patient: WithId<Patient> | undefined;

      await expect(
        repo.withTransaction(async () => {
          // Create one patient
          // This will initially succeed, but should then be rolled back
          patient = await repo.createResource<Patient>({ resourceType: 'Patient' });
          expect(patient).toBeDefined();

          // Read the patient by ID
          // This should succeed within the transaction
          const readCheck1 = await repo.readResource('Patient', patient.id);
          expect(readCheck1).toBeDefined();

          // Search for patient by ID
          // This should succeed within the transaction
          const searchCheck1 = await repo.search<Patient>({
            resourceType: 'Patient',
            filters: [{ code: '_id', operator: Operator.EQUALS, value: patient.id }],
          });
          expect(searchCheck1.entry).toHaveLength(1);

          // Now try to create a malformed patient
          // This will fail, and should rollback the entire transaction
          await repo.createResource<Patient>({ resourceType: 'Patient', foo: 'bar' } as unknown as Patient);
        })
      ).rejects.toMatchObject(
        new OperationOutcomeError({
          resourceType: 'OperationOutcome',
          issue: [
            {
              severity: 'error',
              code: 'structure',
              details: {
                text: 'Invalid additional property "foo"',
              },
              expression: ['Patient.foo'],
            },
          ],
        })
      );

      // Read the patient by ID
      // This should fail, because the transaction was rolled back
      await expect(repo.readResource('Patient', patient?.id as string)).rejects.toThrow('Not found');

      // Search for patient by ID
      // This should return zero results because the transaction was rolled back
      const searchCheck2 = await repo.search<Patient>({
        resourceType: 'Patient',
        filters: [{ code: '_id', operator: Operator.EQUALS, value: patient?.id as string }],
      });
      expect(searchCheck2.entry).toHaveLength(0);
    }));

  test('Nested transaction commit', () =>
    withTestContext(async () => {
      let patient1: Patient | undefined;
      let patient2: Patient | undefined;

      await repo.withTransaction(async () => {
        patient1 = await repo.createResource<Patient>({ resourceType: 'Patient' });
        expect(patient1).toBeDefined();

        await repo.withTransaction(async () => {
          patient2 = await repo.createResource<Patient>({ resourceType: 'Patient' });
          expect(patient2).toBeDefined();
        });
      });
      expect(patient1).toBeDefined();
      expect(patient2).toBeDefined();

      // Read the patient by ID
      // This should succeed
      const readCheck1 = await repo.readResource('Patient', patient1?.id as string);
      expect(readCheck1).toBeDefined();

      // Search for patient by ID
      // This should succeed
      const searchCheck1 = await repo.search<Patient>({
        resourceType: 'Patient',
        filters: [{ code: '_id', operator: Operator.EQUALS, value: patient1?.id as string }],
      });
      expect(searchCheck1.entry).toHaveLength(1);

      // Read the patient by ID
      // This should succeed
      const readCheck2 = await repo.readResource('Patient', patient2?.id as string);
      expect(readCheck2).toBeDefined();

      // Search for patient by ID
      // This should succeed
      const searchCheck2 = await repo.search<Patient>({
        resourceType: 'Patient',
        filters: [{ code: '_id', operator: Operator.EQUALS, value: patient2?.id as string }],
      });
      expect(searchCheck2.entry).toHaveLength(1);
    }));

  test('Nested transaction rollback', () =>
    withTestContext(async () => {
      let patient1: Patient | undefined;
      let patient2: Patient | undefined;

      // Start an outer transaction - this should succeed
      await repo.withTransaction(async () => {
        // Create one patient
        // This will initially succeed, and should not be rolled back
        patient1 = await repo.createResource<Patient>({ resourceType: 'Patient' });
        expect(patient1).toBeDefined();

        // Start an inner transaction - this will be rolled back
        await expect(
          repo.withTransaction(async () => {
            patient2 = await repo.createResource<Patient>({ resourceType: 'Patient' });
            expect(patient2).toBeDefined();

            // Read the patient by ID
            // This should succeed within the transaction
            const readCheck1 = await repo.readResource('Patient', patient1?.id as string);
            expect(readCheck1).toBeDefined();

            // Search for patient by ID
            // This should succeed within the transaction
            const searchCheck1 = await repo.search<Patient>({
              resourceType: 'Patient',
              filters: [{ code: '_id', operator: Operator.EQUALS, value: patient1?.id as string }],
            });
            expect(searchCheck1).toBeDefined();
            expect(searchCheck1.entry).toHaveLength(1);

            // Read the patient by ID
            // This should succeed within the transaction
            const readCheck2 = await repo.readResource('Patient', patient2?.id as string);
            expect(readCheck2).toBeDefined();

            // Search for patient by ID
            // This should succeed within the transaction
            const searchCheck2 = await repo.search<Patient>({
              resourceType: 'Patient',
              filters: [{ code: '_id', operator: Operator.EQUALS, value: patient2?.id as string }],
            });
            expect(searchCheck2).toBeDefined();
            expect(searchCheck2.entry).toHaveLength(1);

            // Now try to create a malformed patient
            // This will fail, and should rollback the entire transaction
            await repo.createResource<Patient>({ resourceType: 'Patient', foo: 'bar' } as unknown as Patient);
          })
        ).rejects.toMatchObject(
          new OperationOutcomeError({
            resourceType: 'OperationOutcome',
            issue: [
              {
                severity: 'error',
                code: 'structure',
                details: {
                  text: 'Invalid additional property "foo"',
                },
                expression: ['Patient.foo'],
              },
            ],
          })
        );

        // Read the patient by ID
        // This should succeed within the transaction
        const readCheck3 = await repo.readResource('Patient', patient1?.id as string);
        expect(readCheck3).toBeDefined();

        // Search for patient by ID
        // This should succeed within the transaction
        const searchCheck3 = await repo.search<Patient>({
          resourceType: 'Patient',
          filters: [{ code: '_id', operator: Operator.EQUALS, value: patient1?.id as string }],
        });
        expect(searchCheck3).toBeDefined();
        expect(searchCheck3.entry).toHaveLength(1);

        // Read the patient by ID
        // This should fail, because the transaction was rolled back
        await expect(repo.readResource('Patient', patient2?.id as string)).rejects.toThrow('Not found');

        // Search for patient by ID
        // This should succeed within the transaction
        const searchCheck4 = await repo.search<Patient>({
          resourceType: 'Patient',
          filters: [{ code: '_id', operator: Operator.EQUALS, value: patient2?.id as string }],
        });
        expect(searchCheck4).toBeDefined();
        expect(searchCheck4.entry).toHaveLength(0);
      });
    }));

  test('Nested transaction rollback from DB error', () =>
    withTestContext(async () => {
      let patient1: Patient | undefined;
      let patient2: Patient | undefined;

      // Start an outer transaction - this should succeed
      await repo.withTransaction(async () => {
        // Create one patient
        // This will initially succeed, and should not be rolled back
        patient1 = await repo.createResource<Patient>({ resourceType: 'Patient' });
        expect(patient1).toBeDefined();

        // Start an inner transaction - this will be rolled back
        await expect(
          repo.withTransaction(async (db) => {
            patient2 = await repo.createResource<Patient>({ resourceType: 'Patient' });
            expect(patient2).toBeDefined();

            // Read the patient by ID
            // This should succeed within the transaction
            const readCheck1 = await repo.readResource('Patient', patient1?.id as string);
            expect(readCheck1).toBeDefined();

            // Search for patient by ID
            // This should succeed within the transaction
            const searchCheck1 = await repo.search<Patient>({
              resourceType: 'Patient',
              filters: [{ code: '_id', operator: Operator.EQUALS, value: patient1?.id as string }],
            });
            expect(searchCheck1).toBeDefined();
            expect(searchCheck1.entry).toHaveLength(1);

            // Read the patient by ID
            // This should succeed within the transaction
            const readCheck2 = await repo.readResource('Patient', patient2?.id as string);
            expect(readCheck2).toBeDefined();

            // Search for patient by ID
            // This should succeed within the transaction
            const searchPreCheck = await repo.search<Patient>({
              resourceType: 'Patient',
              filters: [{ code: '_id', operator: Operator.EQUALS, value: patient2?.id as string }],
            });
            expect(searchPreCheck).toBeDefined();
            expect(searchPreCheck.entry).toHaveLength(1);

            await expect(db.query(`SELECT * FROM "TableDoesNotExist"`)).rejects.toMatchObject({
              message: 'relation "TableDoesNotExist" does not exist',
            });
          })
        ).rejects.toThrow('current transaction is aborted, commands ignored until end of transaction block');

        // Read the patient by ID
        // This should succeed within the transaction
        const readCheck3 = await repo.readResource('Patient', patient1?.id as string);
        expect(readCheck3).toBeDefined();

        // Search for patient by ID
        // This should succeed within the transaction
        const searchCheck3 = await repo.search<Patient>({
          resourceType: 'Patient',
          filters: [{ code: '_id', operator: Operator.EQUALS, value: patient1?.id as string }],
        });
        expect(searchCheck3).toBeDefined();
        expect(searchCheck3.entry).toHaveLength(1);

        // Read the patient by ID
        // This should fail, because the transaction was rolled back
        await expect(repo.readResource('Patient', patient2?.id as string)).rejects.toMatchObject({
          outcome: notFound,
        });

        // Search for patient by ID
        // This should return no results, because the transaction was rolled back
        const searchCheck4 = await repo.search<Patient>({
          resourceType: 'Patient',
          filters: [{ code: '_id', operator: Operator.EQUALS, value: patient2?.id as string }],
        });
        expect(searchCheck4).toBeDefined();
        expect(searchCheck4.entry).toHaveLength(0);
      });

      // Search for patient by ID
      // This should succeed outside the transaction
      const searchCheck3 = await repo.search<Patient>({
        resourceType: 'Patient',
        filters: [{ code: '_id', operator: Operator.EQUALS, value: patient1?.id as string }],
      });
      expect(searchCheck3).toBeDefined();
      expect(searchCheck3.entry).toHaveLength(1);

      // Search for patient by ID
      // This should return no results, because the transaction was rolled back
      const searchCheck4 = await repo.search<Patient>({
        resourceType: 'Patient',
        filters: [{ code: '_id', operator: Operator.EQUALS, value: patient2?.id as string }],
      });
      expect(searchCheck4).toBeDefined();
      expect(searchCheck4.entry).toHaveLength(0);
    }));

  test('Post-commit callback', () =>
    withTestContext(async () => {
      const callback = jest.fn();
      await repo.withTransaction(async () => {
        await repo.postCommit(async () => {
          callback();
        });
        expect(callback).not.toHaveBeenCalled();
      });
      expect(callback).toHaveBeenCalledTimes(1);
    }));

  test('Post-commit callback with rollback', () =>
    withTestContext(async () => {
      const callback = jest.fn();
      try {
        await repo.withTransaction(async () => {
          await repo.postCommit(async () => {
            callback();
          });
          expect(callback).not.toHaveBeenCalled();
          throw new Error('Roll it back!');
        });
        fail('Expected transaction to abort');
      } catch (err) {
        expect(err).toBeDefined();
        expect(callback).not.toHaveBeenCalled();
      }
    }));

  test('Nested transaction post-commit', () =>
    withTestContext(async () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      await repo.withTransaction(async () => {
        await repo.postCommit(async () => {
          cb1();
        });
        await repo.withTransaction(async () => {
          await repo.postCommit(async () => {
            cb2();
          });
          expect(cb1).not.toHaveBeenCalled();
        });
        expect(cb1).not.toHaveBeenCalled();
        expect(cb2).not.toHaveBeenCalled();
      });
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    }));

  test('Conflicting concurrent writes', () =>
    withTestContext(async () => {
      const existing = await repo.createResource<Patient>({ resourceType: 'Patient' });

      const tx1 = repo.withTransaction(async () => {
        await repo.updateResource({ ...existing, gender: 'unknown' });
        await sleep(500);
      });

      await sleep(250);

      const tx2 = systemRepo.withTransaction(async () => {
        await systemRepo.updateResource({ ...existing, deceasedBoolean: false });
      });

      const results = await Promise.allSettled([tx1, tx2]);
      expect(results.map((r) => r.status)).not.toContain('rejected');
    }));

  test('Conflicting concurrent conditional creates', () =>
    withTestContext(async () => {
      const identifier = randomUUID();
      const criteria = 'Patient?identifier=http://example.com/mrn|' + identifier;
      const resource: Patient = {
        resourceType: 'Patient',
        identifier: [{ system: 'http://example.com/mrn', value: identifier }],
      };
      const tx1 = repo.withTransaction(
        async () => {
          const existing = await repo.searchResources(parseSearchRequest(criteria));
          if (!existing.length) {
            await repo.createResource(resource);
          }
          await sleep(500);
        },
        { serializable: true }
      );

      const tx2 = systemRepo.withTransaction(
        async () => {
          await sleep(250);
          const existing = await systemRepo.searchResources(parseSearchRequest(criteria));
          if (!existing.length) {
            await systemRepo.createResource(resource);
          }
        },
        { serializable: true }
      );

      const results = await Promise.allSettled([tx1, tx2]);
      expect(results.map((r) => r.status)).not.toContain('rejected');
    }));

  test('Allowed concurrent conditional creates', () =>
    withTestContext(async () => {
      const identifier = randomUUID();
      const criteria = 'Patient?identifier=http://example.com/mrn|' + identifier;
      const resource: Patient = {
        resourceType: 'Patient',
        identifier: [{ system: 'http://example.com/mrn', value: identifier }],
      };
      const tx1 = repo.withTransaction(async () => {
        const existing = await repo.searchResources(parseSearchRequest(criteria));
        if (!existing.length) {
          await repo.createResource(resource);
        }
        await sleep(500);
      });

      const tx2 = systemRepo.withTransaction(async () => {
        await sleep(250);
        const existing = await systemRepo.searchResources(parseSearchRequest(criteria));
        if (!existing.length) {
          await systemRepo.createResource(resource);
        }
      });

      const results = await Promise.allSettled([tx1, tx2]);
      expect(results.map((r) => r.status)).not.toContain('rejected');
    }));

  test('Conflicting update with patch', () =>
    withTestContext(async () => {
      const existing = await repo.createResource<Patient>({ resourceType: 'Patient' });

      // Simulate patch operation with long delay in the middle to ensure conflict
      const tx1 = repo.withTransaction(async () => {
        await repo.searchResources(parseSearchRequest('Patient?_id=' + existing.id)); // Ensure request hits the DB
        await sleep(500);
        return repo.updateResource({ ...existing, gender: 'other' });
      });

      await sleep(200);

      const tx2 = systemRepo.updateResource({ ...existing, deceasedBoolean: false });

      const results = await Promise.allSettled([tx1, tx2]);
      await expect(repo.readResource(existing.resourceType, existing.id)).resolves.toBeDefined();
      expect(results.map((r) => r.status)).not.toContain('rejected');
    }));

  test('Retry on conflict', () =>
    withTestContext(async () => {
      let returnValue: boolean | undefined;
      const txFn = jest.fn(async (): Promise<boolean> => {
        if (returnValue) {
          return returnValue;
        } else {
          returnValue = true;
          // Emit transaction conflict (Postgres error code 40001)
          throw new OperationOutcomeError(conflict('transaction', PostgresError.SerializationFailure));
        }
      });

      await expect(repo.withTransaction(txFn)).resolves.toStrictEqual(true);
      expect(txFn).toHaveBeenCalledTimes(2);
    }));

  test('Only retry specific transaction conflict', () =>
    withTestContext(async () => {
      let returnValue: boolean | undefined;
      const txFn = jest.fn(async (): Promise<boolean> => {
        if (returnValue) {
          return returnValue;
        } else {
          returnValue = true;
          // Emit some other conflict
          throw new OperationOutcomeError(conflict('a different conflict', 'other-error'));
        }
      });

      await expect(repo.withTransaction(txFn)).rejects.toThrow('a different conflict');
      expect(txFn).toHaveBeenCalledTimes(1);
    }));

  test('Do not retry combined transaction conflict and other errors', () =>
    withTestContext(async () => {
      let returnValue: boolean | undefined;
      const txFn = jest.fn(async (): Promise<boolean> => {
        if (returnValue) {
          return returnValue;
        } else {
          returnValue = true;
          // Emit combined errors
          const outcome = conflict('transaction conflict', PostgresError.SerializationFailure);
          outcome.issue.push({ code: 'invalid', severity: 'error', details: { text: 'invalid data' } });
          throw new OperationOutcomeError(outcome);
        }
      });

      await expect(repo.withTransaction(txFn)).rejects.toThrow('transaction conflict; invalid data');
      expect(txFn).toHaveBeenCalledTimes(1);
    }));

  test('Retry transaction only once before emitting failure', () =>
    withTestContext(async () => {
      const txFn = jest.fn(async (): Promise<boolean> => {
        // Emit transaction conflict (Postgres error code 40001)
        throw new OperationOutcomeError(conflict('transaction conflict', PostgresError.SerializationFailure));
      });

      await expect(repo.withTransaction(txFn)).rejects.toThrow('transaction conflict');
      expect(txFn).toHaveBeenCalledTimes(2);
    }));

  test('Retry nested transaction', () =>
    withTestContext(async () => {
      let returnValue: boolean | undefined;
      const txFn = jest.fn(async (): Promise<boolean> => {
        if (returnValue) {
          return returnValue;
        } else {
          returnValue = true;
          // Emit transaction conflict (Postgres error code 40001)
          throw new OperationOutcomeError(conflict('transaction', PostgresError.SerializationFailure));
        }
      });
      const outerTx = jest.fn(async (): Promise<boolean> => repo.withTransaction(txFn));

      await expect(repo.withTransaction(outerTx)).resolves.toStrictEqual(true);
      expect(txFn).toHaveBeenCalledTimes(2);
      expect(outerTx).toHaveBeenCalledTimes(2);
    }));

  test('Retry nested transaction to failure', () =>
    withTestContext(async () => {
      const txFn = jest.fn(async (): Promise<boolean> => {
        // Emit transaction conflict (Postgres error code 40001)
        throw new OperationOutcomeError(conflict('transaction conflict', PostgresError.SerializationFailure));
      });
      const outerTx = jest.fn(async (): Promise<boolean> => repo.withTransaction(txFn));

      await expect(repo.withTransaction(outerTx)).rejects.toThrow('transaction conflict');
      expect(txFn).toHaveBeenCalledTimes(2);
      expect(outerTx).toHaveBeenCalledTimes(2);
    }));

  test('Nested transaction does not retry independently', () =>
    withTestContext(async () => {
      const txFn = jest.fn(async (): Promise<boolean> => {
        // Emit transaction conflict (Postgres error code 40001)
        throw new OperationOutcomeError(conflict('transaction conflict', PostgresError.SerializationFailure));
      });
      const outerTx = jest.fn(async (): Promise<boolean> => {
        try {
          await repo.withTransaction(txFn);
          return true;
        } catch (_) {
          // Swallow the error
          return false;
        }
      });

      await expect(repo.withTransaction(outerTx)).resolves.toStrictEqual(false);
      expect(txFn).toHaveBeenCalledTimes(1);
      expect(outerTx).toHaveBeenCalledTimes(1);
    }));

  // Backport of upstream connection/transaction-state fixes onto v5.1.5
  // (behavior of #8682, #8987, and the #9029 class fixed by #9082/#9285/#9734).
  describe('Connection state sharing', () => {
    // Ported from upstream #8682 "Clear repo commit hooks on transaction rollback"
    test('Retry after create should not execute post-commit hooks from rollback', () =>
      withTestContext(async () => {
        const { repo: testRepo } = await createTestProject({ withRepo: true });
        const addBackgroundJobsSpy = jest.spyOn(workersModule, 'addBackgroundJobs');
        const patients: WithId<Patient>[] = [];
        let shouldError = true;

        const createdPatient = await testRepo.withTransaction(async () => {
          const patient = await testRepo.createResource<Patient>({ resourceType: 'Patient' });
          patients.push(patient);

          if (shouldError) {
            shouldError = false;
            throw Object.assign(new Error('serialization failure'), { code: PostgresError.SerializationFailure });
          }

          return patient;
        });

        expect(patients).toHaveLength(2);
        expect(createdPatient).toStrictEqual(patients[1]);
        expect(addBackgroundJobsSpy).toHaveBeenCalledTimes(1);

        await expect(testRepo.readResource('Patient', patients[0].id)).rejects.toMatchObject(
          new OperationOutcomeError(notFound)
        );

        addBackgroundJobsSpy.mockRestore();
      }));

    // Ported from upstream #8682
    test('Retry executes post-commit hook once from outer transaction', async () => {
      const postCommit = jest.fn();
      let shouldError = true;

      await systemRepo.withTransaction(async () => {
        await systemRepo.postCommit(postCommit);

        await systemRepo.withTransaction(async () => {
          if (shouldError) {
            shouldError = false;
            throw Object.assign(new Error('serialization failure'), { code: PostgresError.SerializationFailure });
          }
        });
      });

      expect(postCommit).toHaveBeenCalledTimes(1);
    });

    // Ported from upstream #8682
    test('Retry should not execute post-commit hook from rollback', async () => {
      const postCommit = jest.fn();

      await systemRepo.withTransaction(async () => {
        try {
          await systemRepo.withTransaction(async () => {
            await systemRepo.postCommit(postCommit);
            throw Object.assign(new Error('serialization failure'), { code: PostgresError.SerializationFailure });
          });
        } catch {
          // Ignore error
        }
      });

      expect(postCommit).toHaveBeenCalledTimes(0);
    });

    // Ported from upstream #8987 "Transaction dead connection management"
    test('withTransaction releases connection when rollback fails on a dead backend', async () => {
      const { repo: testRepo } = await createTestProject({ withRepo: true });

      const warnSpy = jest.spyOn(getLogger(), 'warn').mockImplementation(() => {});
      const errorSpy = jest.spyOn(getLogger(), 'error').mockImplementation(() => {});
      let querySpy: jest.SpyInstance | undefined;
      let releaseSpy: jest.SpyInstance | undefined;

      await expect(
        testRepo.withTransaction(async (client) => {
          querySpy = jest.spyOn(client, 'query').mockImplementation(() => {
            // Simulates a session killed by idle_in_transaction_session_timeout: every query
            // issued on the client - including the ROLLBACK the error handler sends - rejects.
            throw Object.assign(new Error('terminating connection due to idle-in-transaction timeout'), {
              code: '57P01',
            });
          });
          releaseSpy = jest.spyOn(client, 'release');
          await client.query('SELECT 1');
        })
      ).rejects.toThrow('terminating connection due to idle-in-transaction timeout');

      if (!querySpy || !releaseSpy) {
        throw new Error('spies are undefined');
      }

      // Bookkeeping must be fully reset so the repo is safe for future use
      expect((testRepo as any).transactionDepth).toBe(0);
      expect((testRepo as any).conn).toBeUndefined();

      // Dead client must be released with a truthy err so pg-pool discards it
      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(releaseSpy.mock.calls[0][0]).toBeDefined();

      // The rollback failure should be logged, not thrown
      expect(warnSpy).toHaveBeenCalledWith(
        'Error rolling back transaction',
        expect.objectContaining({
          err: expect.stringContaining('terminating connection'),
        })
      );

      querySpy.mockRestore();
      releaseSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    // Ported from upstream #9082 "Consistent Repository connection state tracking and sharing"
    test('getSystemRepo() shares parent post-commit state', () =>
      withTestContext(async () => {
        const callback = jest.fn();
        let calledBeforeCommit = false;

        await repo.withTransaction(async () => {
          await repo.getSystemRepo().postCommit(callback);
          calledBeforeCommit = callback.mock.calls.length > 0;
        });

        expect(calledBeforeCommit).toBe(false);
        expect(callback).toHaveBeenCalledTimes(1);
      }));

    // Ported from upstream #9082
    test('getSystemRepo() withTransaction() nests in the parent transaction', () =>
      withTestContext(async () => {
        let queries: string[] = [];

        await repo.withTransaction(async (client) => {
          const querySpy = jest.spyOn(client, 'query');
          try {
            await repo.getSystemRepo().withTransaction(async () => undefined);
          } finally {
            queries = querySpy.mock.calls.map(([query]) =>
              typeof query === 'string' ? query : (query as { text: string }).text
            );
            querySpy.mockRestore();
          }
        });

        expect(queries).toContain('SAVEPOINT sp2');
        expect(queries).toContain('RELEASE SAVEPOINT sp2');
        expect(queries).not.toContain('BEGIN ISOLATION LEVEL REPEATABLE READ');
        expect(queries).not.toContain('COMMIT');
      }));

    // Ported from upstream #9082
    test('getSystemRepo() defers cache writes while parent transaction is active', () =>
      withTestContext(async () => {
        let patient: WithId<Patient> | undefined;
        let cacheReadDuringTransaction = false;

        await repo.withTransaction(async () => {
          patient = await repo.getSystemRepo().createResource<Patient>({ resourceType: 'Patient' });
          try {
            await systemRepo.readResource<Patient>('Patient', patient.id, { checkCacheOnly: true });
            cacheReadDuringTransaction = true;
          } catch {
            cacheReadDuringTransaction = false;
          }
        });

        expect(cacheReadDuringTransaction).toBe(false);
        expect(patient).toBeDefined();
        await expect(
          systemRepo.readResource<Patient>('Patient', (patient as WithId<Patient>).id, { checkCacheOnly: true })
        ).resolves.toBeDefined();
      }));

    // Ported from upstream #9082: clone() is fully detached for out-of-band work
    test('clone() does NOT share parent transaction state', () =>
      withTestContext(async () => {
        const callbackFn = jest.fn();
        let patient: WithId<Patient> | undefined;
        await expect(
          repo.withTransaction(async () => {
            const clonedRepo = repo.clone();
            patient = await clonedRepo.createResource<Patient>({ resourceType: 'Patient' });
            await clonedRepo.postCommit(callbackFn);
            expect(callbackFn).toHaveBeenCalledTimes(1);
            throw new Error('rollback clone transaction');
          })
        ).rejects.toThrow('rollback clone transaction');

        expect(callbackFn).toHaveBeenCalledTimes(1);
        expect(patient).toBeDefined();
        await expect(repo.readResource('Patient', (patient as WithId<Patient>).id)).resolves.toStrictEqual(patient);
      }));

    // Ported from upstream #9082
    test('clone does not share the same connection as the original repository', () =>
      withTestContext(async () => {
        let checked = false;
        await repo.withTransaction(async (client) => {
          // starting a transaction will have pinned a connection to `repo`.
          // so ensure that cloning after that pinning does not propagate the pinned connection
          // to the cloned repository.
          const clonedRepo1 = repo.clone();
          expect(clonedRepo1.getDatabaseClient(DatabaseMode.WRITER)).not.toBe(client);
          checked = true;
        });
        expect(checked).toBe(true);
      }));

    // Ported from upstream #9082
    test('constructor and clone add the synthetic R4 project only once to shared context', () => {
      const project: WithId<Project> = {
        resourceType: 'Project',
        id: randomUUID(),
      };
      const context = {
        projects: [project],
        author: {
          reference: 'Practitioner/' + randomUUID(),
        },
      };

      const newRepo = new Repository(context);
      const clonedRepo = newRepo.clone();

      // Repository construction mutates the shared context in place, but repeated
      // construction from that context must not append duplicate synthetic projects.
      expect(context.projects.map((p) => p.id)).toStrictEqual([project.id, r4ProjectId]);
      expect(newRepo.getConfig().projects?.filter((p) => p.id === r4ProjectId)).toHaveLength(1);
      expect(clonedRepo.getConfig().projects?.filter((p) => p.id === r4ProjectId)).toHaveLength(1);
    });

    // konko: regression pin for the production bug - a SystemRepository created during a
    // transaction must not keep using the parent's PoolClient after the transaction ends,
    // where it would issue BEGIN on a connection sitting in the pool's idle list and poison
    // it with a stale REPEATABLE READ snapshot.
    test('system repo created mid-transaction detaches from the released connection', () =>
      withTestContext(async () => {
        let child!: SystemRepository;
        await repo.withTransaction(async (client) => {
          child = repo.getSystemRepo();
          // While the parent transaction is open, the child shares its connection
          expect(child.getDatabaseClient(DatabaseMode.WRITER)).toBe(client);
        });

        // Parent committed; its PoolClient is back in the pool. The child must no longer
        // reference it: reads go to the pool, and it holds no pinned connection.
        expect((child as any).conn).toBeUndefined();
        expect(child.getDatabaseClient(DatabaseMode.WRITER)).toBe(getDatabasePool(DatabaseMode.WRITER));

        // Writes through the escaped child must work and must run on a properly-managed
        // connection (own BEGIN/COMMIT on a fresh checkout, not the parent's old client).
        const patient = await child.createResource<Patient>({ resourceType: 'Patient' });
        await expect(systemRepo.readResource<Patient>('Patient', patient.id)).resolves.toBeDefined();
      }));

    // konko: behavior pin - sharing must keep read-your-own-writes inside the transaction
    test('getSystemRepo() inside a transaction reads uncommitted writes', () =>
      withTestContext(async () => {
        await repo.withTransaction(async () => {
          const patient = await repo.createResource<Patient>({ resourceType: 'Patient' });
          await expect(repo.getSystemRepo().readResource<Patient>('Patient', patient.id)).resolves.toMatchObject({
            id: patient.id,
          });
        });
      }));

    // Adapted from upstream #9082 borrowed-connection tests (5.1.5 getShardSystemRepo API)
    test('borrowed connection is dropped, not released, after fatal rollback', async () => {
      const rollbackError = new Error('rollback failed');
      const client = {
        query: jest.fn(async (query: string) => {
          if (query === 'ROLLBACK') {
            throw rollbackError;
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      } as unknown as PoolClient;
      const borrowedRepo = getShardSystemRepo('test-shard', client);
      const warnSpy = jest.spyOn(getLogger(), 'warn').mockImplementation(() => {});
      const errorSpy = jest.spyOn(getLogger(), 'error').mockImplementation(() => {});

      try {
        await expect(borrowedRepo.withTransaction(async () => Promise.reject(new Error('work failed')))).rejects.toThrow(
          'work failed'
        );

        // The repository only borrowed this PoolClient, so it drops its local reference
        // after the fatal rollback path but never releases a client it does not own.
        expect(client.release).not.toHaveBeenCalled();
        expect((borrowedRepo as any).conn).toBeUndefined();

        await expect(borrowedRepo.withTransaction(async () => undefined)).rejects.toThrow(
          'Borrowed repository connection is no longer available'
        );
      } finally {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });

    // Adapted from upstream #9082
    test('withTransaction does not publish transaction state when BEGIN fails', async () => {
      const beginError = new Error('begin failed');
      const client = {
        query: jest.fn(async () => Promise.reject(beginError)),
        release: jest.fn(),
      } as unknown as PoolClient;
      const borrowedRepo = getShardSystemRepo('test-shard', client);
      const warnSpy = jest.spyOn(getLogger(), 'warn').mockImplementation(() => {});
      const errorSpy = jest.spyOn(getLogger(), 'error').mockImplementation(() => {});

      try {
        await expect(borrowedRepo.withTransaction(async () => undefined)).rejects.toThrow('begin failed');

        // BEGIN never succeeded, so the in-memory state must not claim an active
        // transaction or hold callback frames for one.
        expect((borrowedRepo as any).transactionDepth).toBe(0);
        expect((borrowedRepo as any).preCommitCallbacks).toHaveLength(0);
        expect((borrowedRepo as any).postCommitCallbacks).toHaveLength(0);
        expect(client.release).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });
  });
});
