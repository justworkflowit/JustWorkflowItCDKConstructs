/* eslint-disable @typescript-eslint/no-explicit-any */
import { JustWorkflowIt } from '@justworkflowit/api-client';
import { AssertiveClient, HttpRequest, Identity, IdentityProvider, IdentityProviderConfig } from '@smithy/types';
import { deserializeSmithyError } from './justWorkflowItApiExceptions';
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const endpoint = process.env.API_BASE_URL;

// Helper to cache the client (no repeated instantiation)
let secretsManager: SecretsManagerClient | undefined;

const getSecretsManager = () => {
    if (!secretsManager) {
        secretsManager = new SecretsManagerClient({});
    }
    return secretsManager;
};

/**
 * Fetch a secret value by its name from AWS Secrets Manager.
 */
export const getSecretValueByName = async (secretName: string): Promise<string | undefined> => {
    const client = getSecretsManager();
    const cmd = new GetSecretValueCommand({ SecretId: secretName });
    const resp = await client.send(cmd);
    return resp.SecretString;
};

// Swap getAccessToken to use getSecretValueByName
const getAccessToken = async () => {
    const secretName = process.env.AUTH_SECRET_NAME;
    if (!secretName) throw new Error("AUTH_SECRET_NAME env var not set");
    const secret = await getSecretValueByName(secretName);
    if (!secret) throw new Error("Could not fetch access token secret");
    return secret;
};

type ProviderFactory = (
    config: IdentityProviderConfig
) => IdentityProvider<Identity> | undefined;

const cognitoIdentityProviderFactory: ProviderFactory = (_config) => {
    const identityProvider: IdentityProvider<Identity> = async (_props) => {
        const token = await getAccessToken();
        return {
            id: 'cognito-user',
            token,
        } as Identity;
    };

    return identityProvider;
};

const cognitoBearerSigner = {
    sign: async (request: HttpRequest) => {
        const token = await getAccessToken();
        request.headers['Authorization'] = `Bearer ${token}`;
        return request;
    },
};

const noAuthIdentityProviderFactory: ProviderFactory = (_config) => {
    const identityProvider: IdentityProvider<Identity> = (_props) => {
        return Promise.resolve({
            id: 'anonymous',
        } as Identity);
    };

    return identityProvider;
};

const noAuthSigner = {
    sign: (request: HttpRequest) => {
        return Promise.resolve(request);
    },
};

export const getErrorMessage = (err: unknown): string => {
    const e = err as any;

    const errorType = e?.errorType;
    const message = e?.message;
    const httpStatus = e?.$metadata?.httpStatusCode;

    if (errorType === 'ValidationError' && e.fields) {
        const fieldErrors = Object.entries(e.fields)
            .map(([field, msg]) => `${field}: ${msg}`)
            .join(', ');
        return `Validation Error: ${fieldErrors}`;
    }

    if (errorType && message) return `${errorType}: ${message}`;
    if (message) return message;
    if (httpStatus) return `Unexpected error (${httpStatus})`;

    return 'Unexpected error';
};

export const getApiClient = (): AssertiveClient<JustWorkflowIt> => {
    const client = new JustWorkflowIt({
        endpoint,
        httpAuthSchemes: [
            {
                schemeId: 'aws.auth#cognitoUserPools',
                identityProvider: cognitoIdentityProviderFactory,
                signer: cognitoBearerSigner,
            },
            {
                schemeId: 'smithy.api#noAuth',
                identityProvider: noAuthIdentityProviderFactory,
                signer: noAuthSigner,
            },
        ],
    });

    const proxy = new Proxy(client, {
        get(target, prop: keyof JustWorkflowIt) {
            const orig = target[prop];
            if (typeof orig !== 'function') return orig;

            return async (...args: any[]) => {
                try {
                    return await (orig as any).apply(target, args);
                } catch (err) {
                    const rehydrated = await deserializeSmithyError(err);
                    throw rehydrated;
                }
            };
        },
    });

    return proxy as AssertiveClient<JustWorkflowIt>;
};
