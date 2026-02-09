# @justworkflowit/cdk-constructs

This package provides an easy-to-use AWS CDK construct for integrating your AWS environment with the [JustWorkflowIt](https://justworkflowit.com) platform.

It sets up a secure integration by deploying:

- An **integration Lambda** (deployed in your AWS account, maintained by JustWorkflowIt via NPM updates)
- A **Secrets Manager secret** to store your JustWorkflowIt auth token
- A **cross-account IAM role** that JustWorkflowIt can assume to perform actions on your behalf

---

## 🚀 Quick Start

### 1. Install the package

```bash
npm install @justworkflowit/cdk-constructs
```

### 2. Add the construct to your CDK stack

```ts
import { JustWorkflowItConstructs } from "@justworkflowit/cdk-constructs";

new JustWorkflowItConstructs(this, { disambiguator: "Prod" });
```

---

## 🔐 What It Deploys

| Resource                 | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `SecretsManager::Secret` | Created at `/justworkflowit/api/authToken` — paste your token here |
| `IAM::Role`              | Named `JustWorkflowItExecutionRole` — assumed by JustWorkflowIt    |
| `Lambda::Function`       | Runs inside your account and can call JustWorkflowIt APIs securely |

---

## 📥 Add Your Auth Token

Once deployed, open [Secrets Manager](https://console.aws.amazon.com/secretsmanager/) and edit the secret:

```
/justworkflowit/api/authToken
```

Paste in your auth token from the JustWorkflowIt dashboard.

---

## ✅ Default Permissions Granted

The IAM role created in your account will allow JustWorkflowIt to:

- `lambda:InvokeFunction` – Call your Lambda functions
- `sns:Publish` – Publish messages to SNS topics
- `sqs:SendMessage` – Send messages to SQS queues

This is designed to support typical event-driven integrations. Additional permissions can be added manually if needed.

---

## 📄 Outputs

You may export the IAM Role ARN from your stack if you want to track or reference it elsewhere:

```ts
new cdk.CfnOutput(this, "WorkflowItRoleArn", {
  value: myConstruct.crossAccountRole.roleArn,
});
```

---

## 🧠 Why Use This?

- 🔐 Secure and isolated
- ⚙️ Easy to deploy and revoke
- ✅ Designed for least privilege and extensibility
- 📦 Integrates seamlessly with the JustWorkflowIt ecosystem

---

## 🧪 Coming Soon

- Pre-built Lambda integrations (e.g. syncers, processors)
- Versioned permission sets
- Auto token provisioning (via CDK parameter store or registration link)

---

## 🧰 Requirements

- AWS CDK v2
- Node.js 16+
- Deployed into a CDK stack in your AWS account

---

## 🧑‍💻 License

MIT License — © 2025 JustWorkflowIt
