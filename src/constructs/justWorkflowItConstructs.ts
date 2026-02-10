import {
  CustomResource,
  Duration,
  RemovalPolicy,
  SecretValue,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Runtime, Function, Code } from 'aws-cdk-lib/aws-lambda';
import {
  Role,
  PolicyStatement,
  AccountPrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { ISource, Source, BucketDeployment } from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { JustWorkflowItEngine } from '@justworkflowit/engine';
import {
  JSONSchemaFaker,
  JSONSchemaFakerRefs,
  Schema,
} from 'json-schema-faker';

export interface JustWorkflowItConstructsProps {
  disambiguator: string;
  organizationId: string;
  workflowDefinitions: string[]; // Array of long strings (JSON definitions)
  ignoreDefinitionDeployerFailures?: boolean; // If true, allows silent failures in definition deployer Lambda (default: false)
  lambdaArns?: string[];   // ARNs of Lambdas JustWorkflowIt can invoke
  snsTopicArns?: string[]; // ARNs of SNS topics JustWorkflowIt can publish to
  sqsQueueArns?: string[]; // ARNs of SQS queues JustWorkflowIt can send to
}

export class JustWorkflowItConstructs extends Construct {
  private static readonly CONSTRUCT_ID_PREFIX = 'JustWorkflowItConstructs';
  public readonly executionRole: Role;

  constructor(scope: Construct, props: JustWorkflowItConstructsProps) {
    super(scope, `${JustWorkflowItConstructs.CONSTRUCT_ID_PREFIX}${props.disambiguator}`);

    // Validate all workflow definitions at CDK synth time
    props.workflowDefinitions.forEach((definition, index) => {
      try {
        // Parse the workflow to extract integration types
        const parsedWorkflow = JSON.parse(definition);
        const integrationTypes = new Set<string>();

        if (parsedWorkflow.steps && Array.isArray(parsedWorkflow.steps)) {
          parsedWorkflow.steps.forEach((step: any) => {
            if (step?.integrationDetails?.type) {
              integrationTypes.add(step.integrationDetails.type);
            }
          });
        }

        // Create dummy step executors for validation purposes
        const dummyExecutors = Array.from(integrationTypes).map((type) => ({
          type,
          execute: async () => ({ status: 'success' as const, payload: {} }),
        }));

        // Generate fake workflow input if a workflowInput definition exists
        let fakeWorkflowInputForTypeValidation = undefined;
        if (parsedWorkflow.definitions?.workflowInput) {
          const jsonSchemaFakerRefs: JSONSchemaFakerRefs = Object.entries(
            parsedWorkflow.definitions
          ).reduce(
            (acc, [key, value]) => {
              acc[`#/definitions/${key}`] = value as Schema;
              return acc;
            },
            {} as Record<string, Schema>
          );

          // Configure json-schema-faker to always generate optional fields for thorough validation
          // Note: requiredOnly must be explicitly reset because the engine's two-pass validation
          // sets it to true globally during its second pass, which persists across definitions
          JSONSchemaFaker.option({
            alwaysFakeOptionals: true,
            requiredOnly: false,
          });

          fakeWorkflowInputForTypeValidation = JSONSchemaFaker.generate(
            parsedWorkflow.definitions.workflowInput as Schema,
            jsonSchemaFakerRefs
          ) as Record<string, unknown>;
        }

        // This will throw if the workflow definition is invalid
        new JustWorkflowItEngine({
          workflowDefinition: definition,
          stepExecutors: dummyExecutors,
          workflowInput: fakeWorkflowInputForTypeValidation,
        });
      } catch (error) {
        throw new Error(
          `Invalid workflow definition at index ${index}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

    const secretName = '/justworkflowit/api/authToken';
    const secret = new Secret(this, 'JustWorkflowItAuthTokenSecret', {
      secretName,
      secretStringValue: SecretValue.unsafePlainText('REPLACE_ME_WITH_JUST_WORKFLOW_IT_AUTH_TOKEN'),
      description: 'Replace this placeholder with your JustWorkflowIt API auth token to enable workflow deployment.',
    });

    const bucket = new Bucket(this, 'WorkflowDefinitionsBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: BucketEncryption.S3_MANAGED,
    });

    // Upload each definition and collect its S3 key
    const definitionKeys: string[] = [];
    const deploymentSources: ISource[] = [];

    props.workflowDefinitions.forEach((definition, index) => {
      const uuidKey = `definitions/${uuidv4()}.json`;
      definitionKeys.push(uuidKey);
      deploymentSources.push(Source.data(uuidKey, definition));
    });

    const bucketDeployment = new BucketDeployment(this, 'WorkflowDefinitionUploads', {
      sources: deploymentSources,
      destinationBucket: bucket,
    });

    const integrationLambda = new Function(this, 'JustWorkflowItDefinitionDeployerLambda', {
      functionName: `JustWorkflowItDefinitionDeployer-${props.disambiguator}`,
      code: Code.fromAsset(path.join(__dirname, '../lambda'), {
        exclude: ['*.ts', '*.d.ts'],
      }),
      handler: 'definitionDeployerLambda.handler',
      runtime: Runtime.NODEJS_24_X,
      timeout: Duration.minutes(5),
      environment: {
        AUTH_SECRET_NAME: secretName,
        ORGANIZATION_ID: props.organizationId,
        API_BASE_URL: 'https://api.justworkflowit.com',
        DEFINITION_BUCKET: bucket.bucketName,
        DEFINITION_KEYS_JSON: JSON.stringify(definitionKeys),
        IGNORE_FAILURES: String(props.ignoreDefinitionDeployerFailures ?? false),
      },
    });

    secret.grantRead(integrationLambda);
    bucket.grantRead(integrationLambda);

    const provider = new Provider(this, 'JustWorkflowItDefinitionDeployerTriggerProvider', {
      onEventHandler: integrationLambda,
    });

    const resource = new CustomResource(this, 'JustWorkflowItDefinitionDeployerTrigger', {
      serviceToken: provider.serviceToken,
      properties: {
        timestamp: new Date().toISOString(),
      },
    });

    provider.node.addDependency(bucketDeployment);
    resource.node.addDependency(bucketDeployment);

    // JustWorkflowIt production account - this is the account where the workflow execution engine runs
    // The execution role created here allows JustWorkflowIt to assume it and perform actions in the customer's account
    const JUSTWORKFLOWIT_PRODUCTION_ACCOUNT = '588738588052';

    const executionRole = new Role(this, 'JustWorkflowItAutomationExecutionRole', {
      roleName: `JustWorkflowItExecutionRole`,
      assumedBy: new AccountPrincipal(JUSTWORKFLOWIT_PRODUCTION_ACCOUNT),
      externalIds: [props.organizationId],
      description: 'Role assumed by JustWorkflowIt backend to perform workflow actions in this account.',
    });

    if (props.lambdaArns && props.lambdaArns.length > 0) {
      executionRole.addToPolicy(
        new PolicyStatement({
          actions: ['lambda:InvokeFunction'],
          resources: props.lambdaArns,
        })
      );
    }

    if (props.snsTopicArns && props.snsTopicArns.length > 0) {
      executionRole.addToPolicy(
        new PolicyStatement({
          actions: ['sns:Publish'],
          resources: props.snsTopicArns,
        })
      );
    }

    if (props.sqsQueueArns && props.sqsQueueArns.length > 0) {
      executionRole.addToPolicy(
        new PolicyStatement({
          actions: ['sqs:SendMessage'],
          resources: props.sqsQueueArns,
        })
      );
    }

    this.executionRole = executionRole;
  }
}
