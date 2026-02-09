import { CloudFormationCustomResourceEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getApiClient, getSecretValueByName } from './justWorkflowItApiClient';

const s3 = new S3Client();

const PLACEHOLDER_TOKEN = 'REPLACE_ME_WITH_JUST_WORKFLOW_IT_AUTH_TOKEN';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseNumberEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DEFAULT_REGISTER_ATTEMPTS = parseNumberEnv(
  process.env.REGISTER_WORKFLOW_VERSION_MAX_ATTEMPTS,
  3
);

const DEFAULT_REGISTER_BASE_DELAY_MS = parseNumberEnv(
  process.env.REGISTER_WORKFLOW_VERSION_BASE_DELAY_MS,
  1_000
);

async function streamToString(stream: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on('data', (chunk: any) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const shouldRetryRegister = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') {
    return false;
  }

  const metadataStatus = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  if (typeof metadataStatus === 'number') {
    return metadataStatus >= 500;
  }

  const fallbackStatus = (err as { statusCode?: number }).statusCode;
  if (typeof fallbackStatus === 'number') {
    return fallbackStatus >= 500;
  }

  const smithyFault = (err as { $fault?: string }).$fault;
  return smithyFault === 'server';
};

type RegisterWorkflowVersionInput = {
  organizationId: string;
  workflowId: string;
  definition: string;
};

async function registerWorkflowVersionWithRetry(
  api: ReturnType<typeof getApiClient>,
  payload: RegisterWorkflowVersionInput,
  workflowName: string
) {
  const maxAttempts = Math.max(1, DEFAULT_REGISTER_ATTEMPTS);
  const baseDelayMs = Math.max(0, DEFAULT_REGISTER_BASE_DELAY_MS);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await api.registerWorkflowVersion(payload);
    } catch (err) {
      if (attempt >= maxAttempts || !shouldRetryRegister(err)) {
        throw err;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(
        `⚠️ registerWorkflowVersion attempt ${attempt} of ${maxAttempts} failed for ${workflowName}. Retrying in ${delay}ms...`,
        err
      );
      await sleep(delay);
    }
  }

  throw new Error('registerWorkflowVersionWithRetry exhausted attempts unexpectedly');
}

async function deployWorkflows(
  organizationId: string,
  bucket: string,
  keys: string[]
): Promise<void> {
  const api = getApiClient();

  for (const key of keys) {
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const definitionStr = await streamToString(obj.Body);
      const definitionJson = JSON.parse(definitionStr);

      const workflowName = definitionJson?.workflowName;
      if (!workflowName) {
        throw new Error(`File ${key} — missing "workflowName"`);
      }

      const workflowResponse = await api.listWorkflows({ organizationId });
      const matchingWorkflow = workflowResponse.workflows.find(
        (w) => w.name.toUpperCase() === workflowName.toUpperCase()
      );

      let workflowId: string;

      // If workflow doesn't exist, create it first
      if (!matchingWorkflow) {
        console.log(`ℹ️ Workflow ${workflowName} not found. Creating it...`);
        const createResponse = await api.registerWorkflow({
          organizationId,
          name: workflowName,
        });
        workflowId = createResponse.workflowId;
        console.log(`✅ Created workflow ${workflowName} with ID ${workflowId}`);
      } else {
        workflowId = matchingWorkflow.workflowId;
      }

      const registered = await registerWorkflowVersionWithRetry(
        api,
        {
          organizationId,
          workflowId,
          definition: definitionStr,
        },
        workflowName
      );

      let live: { versionId: string } | null = null;
      try {
        live = await api.getTaggedWorkflowVersion({
          organizationId,
          workflowId,
          tag: '$LIVE',
        });
      } catch (err: any) {
        // Check for NotFoundError - after deserializeSmithyError, the error has errorType property
        if (err?.errorType === 'NotFoundError' || err?.message?.includes('No version tagged') || err?.message?.includes('No version found')) {
          console.log(`ℹ️ No $LIVE version found yet for ${workflowName}`);
        } else {
          throw err;
        }
      }

      if (live?.versionId === registered.versionId) {
        console.log(`🟡 Skipped ${workflowName} — already tagged as $LIVE`);
        continue;
      }

      await api.setWorkflowVersionTag({
        organizationId,
        workflowId,
        tag: '$LIVE',
        versionId: registered.versionId,
      });

      console.log(`✅ Registered and tagged new $LIVE version for: ${workflowName}`);
    } catch (err) {
      console.error(`❌ Error processing ${key}`, err);
      throw err;
    }
  }
}

export const handler = async (event: CloudFormationCustomResourceEvent) => {
  console.log('Custom Resource Event:', JSON.stringify(event, null, 2));

  const { RequestType } = event;
  const bucket = process.env.DEFINITION_BUCKET;
  const organizationId = process.env.ORGANIZATION_ID;
  const authSecretName = process.env.AUTH_SECRET_NAME;
  const keys: string[] = JSON.parse(process.env.DEFINITION_KEYS_JSON || '[]');
  const ignoreFailures = process.env.IGNORE_FAILURES === 'true';

  if (!bucket) {
    throw new Error('Missing S3 bucket from environment variables');
  }

  if (!organizationId) {
    throw new Error('Missing organization ID from environment variables');
  }

  if (!authSecretName) {
    throw new Error('Missing auth secret name from environment variables');
  }

  // Check if the API token is still the placeholder value
  const authToken = await getSecretValueByName(authSecretName);

  if (authToken === PLACEHOLDER_TOKEN) {
    console.log('⚠️ API token is still the placeholder value. Skipping workflow deployment.');
    console.log('ℹ️ To deploy workflows, update the secret with a real JustWorkflowIt API token and trigger a stack update.');

    return {
      PhysicalResourceId: 'JustWorkflowItIntegrationTrigger',
      Data: {
        Message: `Skipped ${RequestType} - placeholder token detected`,
        PlaceholderTokenDetected: 'true',
      },
    };
  }

  if (RequestType === 'Create' || RequestType === 'Update') {
    if (keys.length === 0) {
      console.log('No definitions to deploy');
    } else {
      try {
        await deployWorkflows(organizationId, bucket, keys);
      } catch (error) {
        if (ignoreFailures) {
          console.warn('⚠️ Workflow deployment failed, but IGNORE_FAILURES is enabled');
          console.warn('Error details:', error);
          return {
            PhysicalResourceId: 'JustWorkflowItIntegrationTrigger',
            Data: {
              Message: `${RequestType} completed with ignored failures`,
              FailureIgnored: 'true',
              Error: error instanceof Error ? error.message : String(error),
            },
          };
        }
        throw error;
      }
    }
  } else if (RequestType === 'Delete') {
    console.log('Delete event received. No cleanup required.');
  }

  return {
    PhysicalResourceId: 'JustWorkflowItIntegrationTrigger',
    Data: {
      Message: `Ran ${RequestType} successfully`,
    },
  };
};
