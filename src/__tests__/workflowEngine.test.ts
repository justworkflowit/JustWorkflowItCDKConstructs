import {
  JustWorkflowItEngine,
  JustWorkflowItWorkflowDefinition,
  StepExecutor,
  StepExecutorArguments,
  SampleEngineRunner,
  WorkflowState,
} from '@justworkflowit/engine';

describe('Workflow Engine Integration Tests', () => {
  const simpleIntegration = 'simpleIntegration';

  const outputAPropertyKey = 'outputPropertyA';
  const outputA = {
    [outputAPropertyKey]: 'anOutputPropertyValue',
  };

  const stepExecutorA: StepExecutor = {
    type: simpleIntegration,
    execute: (_args: StepExecutorArguments) =>
      Promise.resolve({
        status: 'success' as const,
        payload: outputA,
      }),
  };

  const stepExecutorB: StepExecutor = {
    type: 'noopIntegration',
    execute: (_args: StepExecutorArguments) =>
      Promise.resolve({
        status: 'success' as const,
        payload: {},
      }),
  };

  const stepExecutors = [stepExecutorA, stepExecutorB];

  const step1Name = 'firstStep';
  const step2Name = 'secondStep';
  const step1InputName = `${step1Name}Input`;
  const step1OutputName = `${step1Name}Output`;
  const step2InputName = `${step2Name}Input`;
  const step2OutputName = `${step2Name}Output`;

  const validWorkflowDefinition: JustWorkflowItWorkflowDefinition = {
    workflowName: 'validWorkflowDefinition',
    steps: [
      {
        name: step1Name,
        retries: 2,
        timeoutSeconds: 1000,
        transitionToStep: step2Name,
        integrationDetails: {
          type: simpleIntegration,
          inputDefinition: {
            $ref: `#/definitions/${step1InputName}`,
          },
          outputDefinition: {
            $ref: `#/definitions/${step1OutputName}`,
          },
          inputTransformer: {
            fieldset: [
              {
                to: 'inputPropertyA',
                withTemplate: 'a brand new field',
              },
            ],
          },
        },
      },
      {
        name: step2Name,
        retries: 2,
        timeoutSeconds: 1000,
        transitionToStep: null,
        integrationDetails: {
          type: simpleIntegration,
          inputDefinition: {
            $ref: `#/definitions/${step2InputName}`,
          },
          outputDefinition: {
            $ref: `#/definitions/${step2OutputName}`,
          },
          inputTransformer: {
            fieldset: [
              {
                from: `${step1Name}Output.${outputAPropertyKey}`,
                to: 'inputPropertyB',
              },
            ],
          },
        },
      },
    ],
    definitions: {
      [step1InputName]: {
        type: 'object',
        properties: {
          inputPropertyA: {
            type: 'string',
          },
        },
        required: ['inputPropertyA'],
        additionalProperties: false,
      },
      [step1OutputName]: {
        type: 'object',
        properties: {
          outputPropertyA: {
            type: 'string',
          },
        },
        required: ['outputPropertyA'],
        additionalProperties: false,
      },
      [step2InputName]: {
        type: 'object',
        properties: {
          inputPropertyB: {
            type: 'string',
          },
        },
        required: ['inputPropertyB'],
        additionalProperties: false,
      },
      [step2OutputName]: {
        type: 'object',
        properties: {
          outputPropertyB: {
            type: 'string',
          },
        },
        required: ['outputPropertyB'],
        additionalProperties: false,
      },
    },
  };

  test('should initialize engine with valid workflow definition', () => {
    expect(() => {
      new JustWorkflowItEngine({
        workflowDefinition: JSON.stringify(validWorkflowDefinition),
        stepExecutors,
      });
    }).not.toThrow();
  });

  test('should execute a valid workflow', async () => {
    const engine = new JustWorkflowItEngine({
      workflowDefinition: JSON.stringify(validWorkflowDefinition),
      stepExecutors,
    });

    const initialState: WorkflowState = {
      nextStepName: step1Name,
      executionData: {},
      executionHistory: [],
    };

    const runner = new SampleEngineRunner(engine, initialState);
    await runner.runUntilTerminalStep();

    const finalState = runner.getCurrentWorkflowState();

    expect(finalState).toBeDefined();
    expect(finalState.nextStepName).toBeNull();
    expect(finalState.executionHistory.length).toBeGreaterThan(0);
  });

  test('should validate workflow definition structure', () => {
    const engine = new JustWorkflowItEngine({
      workflowDefinition: JSON.stringify(validWorkflowDefinition),
      stepExecutors,
    });

    expect(engine).toBeInstanceOf(JustWorkflowItEngine);
  });

  test('should handle workflow with multiple steps', async () => {
    const engine = new JustWorkflowItEngine({
      workflowDefinition: JSON.stringify(validWorkflowDefinition),
      stepExecutors,
    });

    const initialState: WorkflowState = {
      nextStepName: step1Name,
      executionData: {},
      executionHistory: [],
    };

    const runner = new SampleEngineRunner(engine, initialState);
    await runner.runUntilTerminalStep();

    const finalState = runner.getCurrentWorkflowState();

    // Verify that the workflow executed both steps
    expect(finalState.executionHistory.length).toBe(2);
    expect(finalState.executionHistory[0].stepName).toBe(step1Name);
    expect(finalState.executionHistory[1].stepName).toBe(step2Name);
  });

  test('should validate step definitions exist', () => {
    const workflowWithMissingDefinition = {
      ...validWorkflowDefinition,
      definitions: {},
    };

    expect(() => {
      new JustWorkflowItEngine({
        workflowDefinition: JSON.stringify(workflowWithMissingDefinition),
        stepExecutors,
      });
    }).toThrow();
  });

  test('should execute step and transition to next step', async () => {
    const engine = new JustWorkflowItEngine({
      workflowDefinition: JSON.stringify(validWorkflowDefinition),
      stepExecutors,
    });

    const initialState: WorkflowState = {
      nextStepName: step1Name,
      executionData: {},
      executionHistory: [],
    };

    const stateAfterStep1 = await engine.executeNextStep(initialState);

    expect(stateAfterStep1.nextStepName).toBe(step2Name);
    expect(stateAfterStep1.executionHistory.length).toBe(1);
    expect(stateAfterStep1.executionHistory[0].stepName).toBe(step1Name);
    expect(stateAfterStep1.executionHistory[0]?.output?.status).toBe('success');
  });

  test('should reject invalid workflow definition with malformed JSON', () => {
    const invalidJson = '{ "workflowName": "invalid", "steps": [';

    expect(() => {
      new JustWorkflowItEngine({
        workflowDefinition: invalidJson,
        stepExecutors,
      });
    }).toThrow();
  });

  test('should reject workflow definition with missing required fields', () => {
    const workflowMissingSteps = {
      workflowName: 'missingSteps',
      // steps field is missing
    };

    expect(() => {
      new JustWorkflowItEngine({
        workflowDefinition: JSON.stringify(workflowMissingSteps),
        stepExecutors,
      });
    }).toThrow();
  });

  test('should reject workflow definition with invalid step structure', () => {
    const workflowWithInvalidStep = {
      workflowName: 'invalidStep',
      steps: [
        {
          // Missing required 'name' field
          retries: 2,
          timeoutSeconds: 1000,
          transitionToStep: null,
          integrationDetails: {
            type: simpleIntegration,
          },
        },
      ],
      definitions: {},
    };

    expect(() => {
      new JustWorkflowItEngine({
        workflowDefinition: JSON.stringify(workflowWithInvalidStep),
        stepExecutors,
      });
    }).toThrow();
  });

  test('should reject workflow definition with non-existent step executor type', () => {
    const workflowWithBadExecutorType = {
      workflowName: 'badExecutorType',
      steps: [
        {
          name: 'testStep',
          retries: 2,
          timeoutSeconds: 1000,
          transitionToStep: null,
          integrationDetails: {
            type: 'nonExistentExecutorType',
            inputDefinition: {
              $ref: '#/definitions/testInput',
            },
            outputDefinition: {
              $ref: '#/definitions/testOutput',
            },
          },
        },
      ],
      definitions: {
        testInput: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        testOutput: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    };

    expect(() => {
      new JustWorkflowItEngine({
        workflowDefinition: JSON.stringify(workflowWithBadExecutorType),
        stepExecutors,
      });
    }).toThrow();
  });

  test('should reject workflow definition with invalid reference in input transformer', () => {
    const workflowWithInvalidTransformer = {
      workflowName: 'invalidTransformer',
      steps: [
        {
          name: 'testStep',
          retries: 2,
          timeoutSeconds: 1000,
          transitionToStep: null,
          integrationDetails: {
            type: simpleIntegration,
            inputDefinition: {
              $ref: '#/definitions/testInput',
            },
            outputDefinition: {
              $ref: '#/definitions/testOutput',
            },
            inputTransformer: {
              fieldset: [
                {
                  from: 'nonExistentStep.someProperty',
                  to: 'outputProperty',
                },
              ],
            },
          },
        },
      ],
      definitions: {
        testInput: {
          type: 'object',
          properties: {
            outputProperty: {
              type: 'string',
            },
          },
          required: ['outputProperty'],
          additionalProperties: false,
        },
        testOutput: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    };

    expect(() => {
      new JustWorkflowItEngine({
        workflowDefinition: JSON.stringify(workflowWithInvalidTransformer),
        stepExecutors,
      });
    }).toThrow();
  });

  test('should reject workflow with array index reference that may not exist', () => {
    const emptyArrayExecutor: StepExecutor = {
      type: 'emptyArrayExecutor',
      execute: (_args: StepExecutorArguments) =>
        Promise.resolve({
          status: 'success' as const,
          payload: { items: [] },
        }),
    };

    const secondStepExecutor: StepExecutor = {
      type: 'secondStepExecutor',
      execute: (_args: StepExecutorArguments) =>
        Promise.resolve({
          status: 'success' as const,
          payload: {},
        }),
    };

    const workflowWithArrayReference: JustWorkflowItWorkflowDefinition = {
      workflowName: 'arrayReferenceWorkflow',
      steps: [
        {
          name: 'getItems',
          retries: 2,
          timeoutSeconds: 1000,
          transitionToStep: 'processItem',
          integrationDetails: {
            type: 'emptyArrayExecutor',
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
            type: 'secondStepExecutor',
            inputDefinition: {
              $ref: '#/definitions/processItemInput',
            },
            outputDefinition: {
              $ref: '#/definitions/processItemOutput',
            },
            inputTransformer: {
              fieldset: [
                {
                  // This references an array element that may not exist
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
    };

    // Engine performs static type analysis and catches this at definition time
    expect(() => {
      new JustWorkflowItEngine({
        workflowDefinition: JSON.stringify(workflowWithArrayReference),
        stepExecutors: [emptyArrayExecutor, secondStepExecutor],
      });
    }).toThrow(/Missing expected field.*items\[0\]/);
  });
});
