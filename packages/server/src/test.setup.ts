// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { WithId } from '@medplum/core';
import { createReference, getReferenceString, sleep } from '@medplum/core';
import type {
  AccessPolicy,
  AsyncJob,
  Bundle,
  BundleEntry,
  ClientApplication,
  Login,
  Project,
  ProjectMembership,
  Resource,
} from '@medplum/fhirtypes';
import type { Express } from 'express';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import type internal from 'node:stream';
import type { QueryConfigValues, QueryResult, QueryResultRow } from 'pg';
import { Client as PgClient } from 'pg';
import request from 'supertest';
import type { ServerInviteResponse } from './admin/invite';
import { inviteUser } from './admin/invite';
import type { MedplumRedisConfig } from './config/types';
import { RequestContext } from './context';
import type { RepositoryContext } from './fhir/repo';
import { getProjectSystemRepo, getShardSystemRepo, Repository } from './fhir/repo';
import { PLACEHOLDER_SHARD_ID } from './fhir/sharding';
import type { PgQueryable } from './fhir/sql';
import { generateAccessToken } from './oauth/keys';
import { tryLogin } from './oauth/utils';
import { requestContextStore } from './request-context-store';

// supertest v7 can cause websocket tests to hang without this
setDefaultResultOrder('ipv4first');

export interface TestProjectOptions {
  project?: Partial<Project>;
  accessPolicy?: Partial<AccessPolicy>;
  membership?: Partial<ProjectMembership>;
  superAdmin?: boolean;
  withClient?: boolean;
  withAccessToken?: boolean;
  withRepo?: boolean | Partial<RepositoryContext>;
}

type Exact<T, U extends T> = T & Record<Exclude<keyof U, keyof T>, never>;
type StrictTestProjectOptions<T extends TestProjectOptions> = Exact<TestProjectOptions, T>;

export type TestProjectResult<T extends TestProjectOptions> = {
  project: WithId<Project>;
  accessPolicy: T['accessPolicy'] extends Partial<AccessPolicy> ? WithId<AccessPolicy> : undefined;
  client: T['withClient'] extends true ? WithId<ClientApplication> : undefined;
  membership: T['withClient'] extends true ? WithId<ProjectMembership> : undefined;
  login: T['withAccessToken'] extends true ? WithId<Login> : undefined;
  accessToken: T['withAccessToken'] extends true ? string : undefined;
  repo: T['withRepo'] extends true | Partial<RepositoryContext> ? Repository : undefined;
};

export async function createTestProject<T extends StrictTestProjectOptions<T> = TestProjectOptions>(
  options?: T
): Promise<TestProjectResult<T>> {
  const systemRepo = getShardSystemRepo(PLACEHOLDER_SHARD_ID); // shardId will be an optional input parameter
  const project = await systemRepo.createResource<Project>({
    resourceType: 'Project',
    name: 'Test Project',
    owner: {
      reference: 'User/' + randomUUID(),
    },
    strictMode: true,
    features: ['bots', 'email', 'graphql-introspection', 'cron'],
    secret: [
      {
        name: 'foo',
        valueString: 'bar',
      },
    ],
    superAdmin: options?.superAdmin,
    ...options?.project,
  });

  let client: WithId<ClientApplication> | undefined;
  let accessPolicy: AccessPolicy | undefined;
  let membership: ProjectMembership | undefined;
  let login: WithId<Login> | undefined;
  let accessToken: string | undefined;
  let repo: Repository | undefined;

  if (options?.withClient || options?.withAccessToken || options?.withRepo) {
    client = await systemRepo.createResource<ClientApplication>({
      resourceType: 'ClientApplication',
      secret: randomUUID(),
      redirectUris: ['https://example.com/'],
      meta: {
        project: project.id,
      },
      name: 'Test Client Application',
      signInForm: {
        welcomeString: 'Test Welcome String',
        logo: {
          url: 'https://example.com/logo.png',
        },
      },
    });

    if (options?.accessPolicy) {
      accessPolicy = await systemRepo.createResource<AccessPolicy>({
        resourceType: 'AccessPolicy',
        meta: { project: project.id },
        ...options.accessPolicy,
      });
    }

    membership = await systemRepo.createResource<ProjectMembership>({
      resourceType: 'ProjectMembership',
      user: createReference(client),
      profile: createReference(client),
      project: createReference(project),
      accessPolicy: accessPolicy ? createReference(accessPolicy) : undefined,
      ...options?.membership,
    });

    if (options?.withAccessToken) {
      const scope = 'openid';

      login = await systemRepo.createResource<Login>({
        resourceType: 'Login',
        authMethod: 'client',
        user: createReference(client),
        client: createReference(client),
        membership: createReference(membership),
        authTime: new Date().toISOString(),
        scope,
      });

      accessToken = await generateAccessToken({
        login_id: login.id,
        sub: client.id,
        username: client.id,
        client_id: client.id,
        profile: client.resourceType + '/' + client.id,
        scope,
      });
    }

    if (options?.withRepo) {
      const repoContext: RepositoryContext = {
        projects: [project],
        currentProject: project,
        author: createReference(client),
        superAdmin: options?.superAdmin,
        projectAdmin: options?.membership?.admin,
        accessPolicy,
        strictMode: project.strictMode,
        extendedMode: true,
        checkReferencesOnWrite: project.checkReferencesOnWrite,
      };

      if (typeof options.withRepo === 'object') {
        Object.assign(repoContext, options.withRepo);
      }
      repo = new Repository(repoContext);
    }
  }

  return {
    project,
    accessPolicy,
    client,
    membership,
    login,
    accessToken,
    repo,
  } as TestProjectResult<T>;
}

export async function createTestClient(options?: TestProjectOptions): Promise<WithId<ClientApplication>> {
  return (await createTestProject({ ...options, withClient: true })).client;
}

export async function initTestAuth(options?: TestProjectOptions): Promise<string> {
  return (await createTestProject({ ...options, withAccessToken: true })).accessToken;
}

export async function addTestUser(
  project: WithId<Project>,
  accessPolicy?: AccessPolicy
): Promise<ServerInviteResponse & { accessToken: string }> {
  if (accessPolicy) {
    const systemRepo = await getProjectSystemRepo(project);
    accessPolicy = await systemRepo.createResource<AccessPolicy>({
      ...accessPolicy,
      meta: { project: project.id },
    });
  }

  const email = randomUUID() + '@example.com';
  const password = randomUUID();
  const inviteResponse = await inviteUser({
    project,
    email,
    password,
    resourceType: 'Practitioner',
    firstName: 'Bob',
    lastName: 'Jones',
    sendEmail: false,
    membership: {
      accessPolicy: accessPolicy && createReference(accessPolicy),
    },
  });

  const { user, profile } = inviteResponse;

  const login = await tryLogin({
    authMethod: 'password',
    email,
    password,
    scope: 'openid',
    nonce: 'nonce',
  });

  const accessToken = await generateAccessToken({
    login_id: login.id,
    sub: user.id,
    username: user.id,
    scope: login.scope as string,
    profile: getReferenceString(profile),
  });

  return { ...inviteResponse, accessToken };
}

/**
 * Sets up the pwnedPassword mock to handle "Have I Been Pwned" requests.
 * @param pwnedPassword - The pwnedPassword mock.
 * @param numPwns - The mock value to return. Zero is a safe password.
 */
export function setupPwnedPasswordMock(pwnedPassword: jest.Mock, numPwns: number): void {
  pwnedPassword.mockImplementation(async () => numPwns);
}

/**
 * Sets up the fetch mock to handle Recaptcha requests.
 * @param fetch - The fetch mock.
 * @param success - Whether the mock should return a successful response.
 */
export function setupRecaptchaMock(fetch: jest.Mock, success: boolean): void {
  fetch.mockImplementation(() => ({
    status: 200,
    json: () => ({ success }),
  }));
}

/**
 * Returns true if the resource is in an entry in the bundle.
 * @param bundle - A bundle of resources.
 * @param resource - The resource to search for.
 * @returns The matching bundle entry, or undefined if not found
 */
export function bundleContains(bundle: Bundle, resource: Resource): BundleEntry | undefined {
  return bundle.entry?.find((entry) => entry.resource?.id === resource.id);
}

/**
 * Waits for a function to evaluate successfully.
 * Use this to wait for async behaviors without a handle.
 * @param fn - Function to call.
 */
export function waitFor(fn: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      fn()
        .then(() => {
          clearTimeout(timer);
          resolve();
        })
        .catch(() => {
          // ignore
        });
    }, 100);
  });
}

export async function waitForAsyncJob(contentLocation: string, app: Express, accessToken: string): Promise<AsyncJob> {
  for (let i = 0; i < 100; i++) {
    const res = await request(app)
      .get(new URL(contentLocation).pathname)
      .set('Authorization', 'Bearer ' + accessToken);
    if (res.status !== 202) {
      await sleep(500); // Buffer time to ensure that any remaining async processing has fully completed
      return res.body as AsyncJob;
    }
    await sleep(450);
  }
  throw new Error('Async Job did not complete');
}

const DEFAULT_TEST_CONTEXT = { requestId: 'test-request-id', traceId: 'test-trace-id' };
export function withTestContext<T>(fn: () => T, ctx?: { requestId?: string; traceId?: string }): T {
  const defaults = ctx ?? DEFAULT_TEST_CONTEXT;
  const context = new RequestContext(defaults.requestId ?? '', defaults.traceId ?? '');
  return requestContextStore.run(context, fn);
}

/**
 * Reads a stream into a string.
 * See: https://stackoverflow.com/a/49428486/2051724
 * @param stream - The readable stream.
 * @returns The string contents.
 */
export function streamToString(stream: internal.Readable): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

export type TestRedisConfig = MedplumRedisConfig & {
  keyPrefix: string;
};

/**
 * Deletes all keys from the given Redis instance that match the given prefix. This should be preferred to
 * `flushdb` when possible.
 *
 * @param redisInstance - The Redis instance to delete keys from.
 * @param prefix - The prefix to match against.
 * @returns The number of keys deleted.
 */
export async function deleteRedisKeys(redisInstance: Redis, prefix: string): Promise<number> {
  const stream = redisInstance.scanStream({
    match: prefix + '*',
    count: 100, // Process 100 keys per batch
  });

  let totalDeleted = 0;
  const deletePromises: Promise<number>[] = [];

  stream.on('data', (keys: string[]) => {
    if (keys.length > 0) {
      // ioredis does NOT include options.keyPrefix in the keys returned by `scanStream`,
      // so we need to remove it manually before calling del, where ioredis automatically
      // includes the keyPrefix in the keys passed to del
      const keysToDelete = redisInstance.options.keyPrefix
        ? keys.map((k) => (k.startsWith(prefix) ? k.replace(prefix, '') : k))
        : keys;
      if (keysToDelete.length > 0) {
        deletePromises.push(redisInstance.del(keysToDelete));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    stream.on('end', () => resolve());
    stream.on('error', (err) => reject(err));
  });

  const deletedCounts = await Promise.all(deletePromises);
  totalDeleted = deletedCounts.reduce((sum, count) => sum + count, 0);

  return totalDeleted;
}

/**
 * Installs a jest spy on `PgClient.prototype.query` that consults `interceptor`
 * for each query and restores the spy after `fn` settles. The interceptor receives
 * the SQL text (if any) and may:
 *  - throw — the query rejects with the thrown error
 *  - return a value — the query resolves with that value (the real DB is not hit)
 *  - return undefined — the real query implementation runs
 *
 * Useful for injecting failures at the PG layer, which is necessary because the
 * reindex worker runs its search via the transaction-scoped repo created inside
 * `systemRepo.withTransaction(...)` — a distinct instance from `systemRepo`, so
 * spying on `systemRepo.search` does not intercept it.
 * @param interceptor - Called for each PG query with the SQL text; throws to reject, returns a value to resolve, or returns undefined to delegate to the real query.
 * @param fn - The async block to run while the interceptor is installed.
 * @returns The resolved value of `fn`.
 */
export async function withQueryInterceptor<T>(
  interceptor: (sql: string | undefined) => unknown,
  fn: () => Promise<T>
): Promise<T> {
  const realQuery = PgClient.prototype.query;
  const spy = jest.spyOn(PgClient.prototype, 'query').mockImplementation(async function (
    this: PgClient,
    ...args: unknown[]
  ): Promise<any> {
    const query = args[0] as string | { text?: string } | undefined;
    const sql = typeof query === 'string' ? query : query?.text;
    const result = await interceptor(sql);
    if (result !== undefined) {
      return result;
    }
    return (realQuery as any).apply(this, args);
  });
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

/**
 * Convenience function to spy on the `query` method of the given `client: PgQueryable` returning
 * the spy cast to the `query` overload signature commonly used in the codebase.
 * @param client - The client to spy on.
 * @returns The spy instance.
 */
export function spyOnQuery<R extends QueryResultRow = any, I = any[]>(
  client: PgQueryable
): jest.SpyInstance<Promise<QueryResult<R>>, [string, QueryConfigValues<I>]> {
  return jest.spyOn(client, 'query') as unknown as jest.SpyInstance<
    Promise<QueryResult<R>>,
    [string, QueryConfigValues<I>]
  >;
}
