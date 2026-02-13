# GuardrailX

GuardrailX is an AI compliance and guardrail copilot for regulated knowledge work. It provides intelligent risk assessment, policy enforcement, and compliance review capabilities for AI-generated content in high-stakes domains such as financial services, legal, and healthcare.

## Overview

GuardrailX acts as a comprehensive safety layer for AI systems operating in regulated environments. It evaluates user queries and AI responses through a multi-stage pipeline that classifies risks, applies domain-specific policies, and ensures compliance with organizational and regulatory requirements.

## Key Features

- **Multi-Level Risk Classification**: Automated risk assessment across LOW, MEDIUM, HIGH, and CRITICAL levels
- **Domain-Specific Policies**: Specialized compliance rules for financial, legal, PII, and other regulated domains
- **Compliance Review Pipeline**: Automated review system with evidence collection and audit trails
- **Refusal Pattern Management**: Intelligent handling of high-risk scenarios with context-appropriate responses
- **Structured Output Schemas**: JSON-based specifications for consistent risk classification and compliance reporting
- **Golden Test Suite**: Comprehensive test cases with expected outputs for validation and regression testing

## Architecture

### Pipeline Flow

GuardrailX operates through a multi-stage pipeline:

1. **Risk Classification**: Initial assessment of user queries and AI responses
2. **Response Generation**: Context-aware response generation based on risk level
3. **Compliance Review**: Final compliance check with policy enforcement
4. **Audit Logging**: Evidence collection and compliance audit trail

See [`pipeline/05_end_to_end_flow.md`](pipeline/05_end_to_end_flow.md) for detailed flow documentation.

### Threat Model

The system addresses various threat vectors including prompt injection, policy circumvention, and data leakage. See [`pipeline/06_threat_model.md`](pipeline/06_threat_model.md) for comprehensive threat analysis.

## Project Structure

```
GuardrailX/
├── compliance/           # Compliance framework and audit infrastructure
│   ├── audit/           # Audit log schemas and specifications
│   ├── evidence/        # Compliance evidence collection
│   └── policies/        # Risk taxonomy and compliance policies
├── docs/                # Additional documentation
├── pipeline/            # Pipeline architecture and flow documentation
│   ├── 05_end_to_end_flow.md
│   └── 06_threat_model.md
├── policies/            # Policy definitions and enforcement rules
│   ├── core/           # Core risk level definitions
│   └── domains/        # Domain-specific policies (financial, legal, PII)
├── prompts/             # AI system and pipeline prompts
│   ├── classifiers/    # Risk classification prompts
│   ├── generators/     # Response generation prompts
│   ├── pipelines/      # Pipeline orchestration prompts
│   ├── refusals/       # Refusal pattern templates
│   └── system/         # Core system prompts
├── schemas/             # Structured output specifications
│   └── outputs/        # JSON schemas for risk classification and compliance review
└── tests/               # Test suite
    └── golden/         # Golden test cases with expected outputs
```

## Components

### Prompts

AI prompts that drive the guardrail system:

- **System Prompts** ([`prompts/system/guardrailx_system.md`](prompts/system/guardrailx_system.md)): Core system behavior and guidelines
- **Risk Classifier** ([`prompts/classifiers/01_risk_classifier.md`](prompts/classifiers/01_risk_classifier.md)): Risk assessment logic
- **Response Generator** ([`prompts/generators/02_response_generator.md`](prompts/generators/02_response_generator.md)): Context-aware response generation
- **Compliance Reviewer** ([`prompts/pipelines/03_compliance_reviewer.md`](prompts/pipelines/03_compliance_reviewer.md)): Final compliance validation
- **Refusal Patterns** ([`prompts/refusals/04_refusal_patterns.md`](prompts/refusals/04_refusal_patterns.md)): High-risk scenario handling

### Policies

Compliance policies and risk frameworks:

- **Risk Levels** ([`policies/core/risk_levels.md`](policies/core/risk_levels.md)): Core risk level definitions (LOW, MEDIUM, HIGH, CRITICAL)
- **Financial Domain** ([`policies/domains/financial.md`](policies/domains/financial.md)): Financial services compliance rules
- **Legal Domain** ([`policies/domains/legal.md`](policies/domains/legal.md)): Legal practice compliance requirements
- **PII Domain** ([`policies/domains/pii.md`](policies/domains/pii.md)): Personal information protection policies

### Schemas

Structured output specifications:

- **Risk Classification** ([`schemas/outputs/risk_classification.json`](schemas/outputs/risk_classification.json)): Risk assessment output format
- **Compliance Review** ([`schemas/outputs/compliance_review.json`](schemas/outputs/compliance_review.json)): Compliance review output format

### Compliance Framework

Audit and evidence infrastructure:

- **Compliance Evidence** ([`compliance/evidence/README.md`](compliance/evidence/README.md)): Evidence collection and management
- **Audit Logs** ([`compliance/audit/03_compliance_audit_log_schema.md`](compliance/audit/03_compliance_audit_log_schema.md)): Audit log schemas
- **Risk Taxonomy** ([`compliance/policies/risk_taxonomy.md`](compliance/policies/risk_taxonomy.md)): Comprehensive risk classification system

### Tests

Validation and regression testing:

- **Golden Prompts** ([`tests/golden/prompts.md`](tests/golden/prompts.md)): Test case inputs
- **Expected Outputs** ([`tests/golden/expected_outputs.md`](tests/golden/expected_outputs.md)): Expected results for validation

## Getting Started

1. **Review System Prompts**: Start with [`prompts/system/guardrailx_system.md`](prompts/system/guardrailx_system.md) to understand core behavior
2. **Understand Risk Levels**: Review [`policies/core/risk_levels.md`](policies/core/risk_levels.md) for risk classification criteria
3. **Explore Domain Policies**: Check domain-specific policies in [`policies/domains/`](policies/domains/)
4. **Review Pipeline Flow**: See [`pipeline/05_end_to_end_flow.md`](pipeline/05_end_to_end_flow.md) for system architecture
5. **Run Test Cases**: Validate functionality using test cases in [`tests/golden/`](tests/golden/)

## Use Cases

- **Financial Services**: Enforce compliance with financial regulations and prevent unauthorized advice
- **Legal Practice**: Ensure legal responses meet professional standards and ethical requirements
- **Healthcare**: Protect patient information and enforce HIPAA/medical privacy requirements
- **Enterprise AI**: General-purpose AI safety for regulated business environments

## Compliance & Audit

GuardrailX maintains comprehensive audit trails and compliance evidence:

- All risk classifications are logged with justifications
- Policy violations are documented with evidence
- Compliance reviews include detailed reasoning and policy references
- Audit logs support regulatory review and incident investigation

## License

See [LICENSE](LICENSE) for details.

## Contributing

This project is designed as a framework for AI compliance and safety. Contributions should maintain the security and compliance posture of the system.
