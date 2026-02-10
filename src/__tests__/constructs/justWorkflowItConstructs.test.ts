import { App, Stack } from 'aws-cdk-lib';
import { JustWorkflowItConstructs } from '../../constructs/justWorkflowItConstructs';

describe('JustWorkflowItConstructs', () => {
  const validWorkflowDefinition = JSON.stringify({
    workflowName: 'validWorkflow',
    steps: [
      {
        name: 'step1',
        retries: 2,
        timeoutSeconds: 1000,
        transitionToStep: null,
        integrationDetails: {
          type: 'testIntegration',
          inputDefinition: {
            $ref: '#/definitions/step1Input',
          },
          outputDefinition: {
            $ref: '#/definitions/step1Output',
          },
        },
      },
    ],
    definitions: {
      step1Input: {
        type: 'object',
        properties: {
          inputProperty: {
            type: 'string',
          },
        },
        required: ['inputProperty'],
        additionalProperties: false,
      },
      step1Output: {
        type: 'object',
        properties: {
          outputProperty: {
            type: 'string',
          },
        },
        required: ['outputProperty'],
        additionalProperties: false,
      },
    },
  });

  test('should create construct with valid workflow definition', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    expect(() => {
      new JustWorkflowItConstructs(stack, {
        disambiguator: 'test',
        organizationId: 'org123',
        workflowDefinitions: [validWorkflowDefinition],
      });
    }).not.toThrow();
  });

  test('should reject construct with invalid workflow definition at synth time', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    const invalidWorkflowDefinition = JSON.stringify({
      workflowName: 'invalidWorkflow',
      steps: [
        {
          // Missing required 'name' field
          retries: 2,
          timeoutSeconds: 1000,
          transitionToStep: null,
          integrationDetails: {
            type: 'testIntegration',
          },
        },
      ],
      definitions: {},
    });

    expect(() => {
      new JustWorkflowItConstructs(stack, {
        disambiguator: 'test',
        organizationId: 'org123',
        workflowDefinitions: [invalidWorkflowDefinition],
      });
    }).toThrow(/Invalid workflow definition at index 0/);
  });

  test('should reject construct with malformed JSON workflow definition', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    const malformedJson = '{ "workflowName": "invalid", "steps": [';

    expect(() => {
      new JustWorkflowItConstructs(stack, {
        disambiguator: 'test',
        organizationId: 'org123',
        workflowDefinitions: [malformedJson],
      });
    }).toThrow(/Invalid workflow definition at index 0/);
  });

  test('should validate multiple workflow definitions and report correct index on failure', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    const invalidAtIndex1 = JSON.stringify({
      workflowName: 'invalid',
      // Missing steps
    });

    expect(() => {
      new JustWorkflowItConstructs(stack, {
        disambiguator: 'test',
        organizationId: 'org123',
        workflowDefinitions: [
          validWorkflowDefinition,
          invalidAtIndex1,
          validWorkflowDefinition,
        ],
      });
    }).toThrow(/Invalid workflow definition at index 1/);
  });

  test('should reject workflow with array index that may not exist', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    const workflowWithArrayRef = JSON.stringify({
      workflowName: 'arrayRefWorkflow',
      steps: [
        {
          name: 'getItems',
          retries: 2,
          timeoutSeconds: 1000,
          transitionToStep: 'processItem',
          integrationDetails: {
            type: 'getItemsIntegration',
            inputDefinition: {
              $ref: '#/definitions/getItemsInput',
            },
            outputDefinition: {
              $ref: '#/definitions/getItemsOutput',
            },
          },
        },
        {
          name: 'processItem',
          retries: 2,
          timeoutSeconds: 1000,
          transitionToStep: null,
          integrationDetails: {
            type: 'processItemIntegration',
            inputDefinition: {
              $ref: '#/definitions/processItemInput',
            },
            outputDefinition: {
              $ref: '#/definitions/processItemOutput',
            },
            inputTransformer: {
              fieldset: [
                {
                  from: 'getItemsOutput.items[0].id',
                  to: 'itemId',
                },
              ],
            },
          },
        },
      ],
      definitions: {
        getItemsInput: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        getItemsOutput: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                },
              },
            },
          },
          required: ['items'],
          additionalProperties: false,
        },
        processItemInput: {
          type: 'object',
          properties: {
            itemId: { type: 'string' },
          },
          required: ['itemId'],
          additionalProperties: false,
        },
        processItemOutput: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    });

    expect(() => {
      new JustWorkflowItConstructs(stack, {
        disambiguator: 'test',
        organizationId: 'org123',
        workflowDefinitions: [workflowWithArrayRef],
      });
    }).toThrow(/Invalid workflow definition at index 0.*items\[0\]/);
  });

  test('should accept workflow with workflowInput definition', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    const workflowWithInput = JSON.stringify({
      workflowName: 'workflowWithInput',
      steps: [
        {
          name: 'step1',
          retries: 2,
          timeoutSeconds: 1000,
          transitionToStep: null,
          integrationDetails: {
            type: 'testIntegration',
            inputTransformer: {
              fieldset: [
                {
                  from: 'workflowInput.businessId',
                  to: 'businessId',
                },
              ],
            },
            inputDefinition: {
              $ref: '#/definitions/step1Input',
            },
            outputDefinition: {
              $ref: '#/definitions/step1Output',
            },
          },
        },
      ],
      definitions: {
        workflowInput: {
          type: 'object',
          properties: {
            businessId: {
              type: 'string',
            },
          },
          required: ['businessId'],
          additionalProperties: false,
        },
        step1Input: {
          type: 'object',
          properties: {
            businessId: {
              type: 'string',
            },
          },
          required: ['businessId'],
          additionalProperties: false,
        },
        step1Output: {
          type: 'object',
          properties: {
            result: {
              type: 'string',
            },
          },
          required: ['result'],
          additionalProperties: false,
        },
      },
    });

    expect(() => {
      new JustWorkflowItConstructs(stack, {
        disambiguator: 'test',
        organizationId: 'org123',
        workflowDefinitions: [workflowWithInput],
      });
    }).not.toThrow();
  });

  test('should accept workflow with complex workflowInput and nested definitions', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    const workflowWithComplexInput = JSON.stringify({
      workflowName: 'complexInputWorkflow',
      steps: [
        {
          name: 'step1',
          retries: 2,
          timeoutSeconds: 1000,
          transitionToStep: null,
          integrationDetails: {
            type: 'testIntegration',
            inputTransformer: {
              fieldset: [
                {
                  from: 'workflowInput.businessId',
                  to: 'businessId',
                },
                {
                  from: 'workflowInput.metadata.location',
                  to: 'location',
                },
              ],
            },
            inputDefinition: {
              $ref: '#/definitions/step1Input',
            },
            outputDefinition: {
              $ref: '#/definitions/step1Output',
            },
          },
        },
      ],
      definitions: {
        workflowInput: {
          type: 'object',
          properties: {
            businessId: {
              type: 'string',
            },
            metadata: {
              $ref: '#/definitions/metadataType',
            },
          },
          required: ['businessId', 'metadata'],
          additionalProperties: false,
        },
        metadataType: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
            },
            tags: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
          },
          required: ['location'],
          additionalProperties: false,
        },
        step1Input: {
          type: 'object',
          properties: {
            businessId: {
              type: 'string',
            },
            location: {
              type: 'string',
            },
          },
          required: ['businessId', 'location'],
          additionalProperties: false,
        },
        step1Output: {
          type: 'object',
          properties: {
            result: {
              type: 'string',
            },
          },
          required: ['result'],
          additionalProperties: false,
        },
      },
    });

    expect(() => {
      new JustWorkflowItConstructs(stack, {
        disambiguator: 'test',
        organizationId: 'org123',
        workflowDefinitions: [workflowWithComplexInput],
      });
    }).not.toThrow();
  });

  test('should accept workflow without workflowInput definition (backward compatibility)', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    const workflowWithoutInput = JSON.stringify({
      workflowName: 'noInputWorkflow',
      steps: [
        {
          name: 'step1',
          retries: 2,
          timeoutSeconds: 1000,
          transitionToStep: null,
          integrationDetails: {
            type: 'testIntegration',
            inputDefinition: {
              $ref: '#/definitions/step1Input',
            },
            outputDefinition: {
              $ref: '#/definitions/step1Output',
            },
          },
        },
      ],
      definitions: {
        step1Input: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        step1Output: {
          type: 'object',
          properties: {
            result: {
              type: 'string',
            },
          },
          required: ['result'],
          additionalProperties: false,
        },
      },
    });

    expect(() => {
      new JustWorkflowItConstructs(stack, {
        disambiguator: 'test',
        organizationId: 'org123',
        workflowDefinitions: [workflowWithoutInput],
      });
    }).not.toThrow();
  });
});
