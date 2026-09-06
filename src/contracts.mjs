import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

const schemaUrls = {
  event: new URL("../contracts/generation-event.schema.json", import.meta.url),
  node: new URL("../contracts/scene-node.schema.json", import.meta.url),
  request: new URL("../contracts/generation-request.schema.json", import.meta.url),
  dataset: new URL("../contracts/p0-dataset.schema.json", import.meta.url),
};

function readSchema(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

const schemas = {
  event: readSchema(schemaUrls.event),
  node: readSchema(schemaUrls.node),
  request: readSchema(schemaUrls.request),
  dataset: readSchema(schemaUrls.dataset),
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(schemas.node);

const validators = {
  event: ajv.compile(schemas.event),
  node: ajv.getSchema(schemas.node.$id),
  request: ajv.compile(schemas.request),
  dataset: ajv.compile(schemas.dataset),
};

export class ContractError extends Error {
  constructor(contract, errors) {
    const details = (errors || [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    super(`${contract} contract rejected: ${details}`);
    this.name = "ContractError";
    this.contract = contract;
    this.errors = errors || [];
  }
}

function assertContract(name, value) {
  const validate = validators[name];
  if (!validate(value)) {
    throw new ContractError(name, structuredClone(validate.errors));
  }
  return value;
}

export const assertGenerationEvent = (value) => assertContract("event", value);
export const assertGenerationRequest = (value) => assertContract("request", value);
export const assertP0Dataset = (value) => assertContract("dataset", value);
export const assertSceneNode = (value) => assertContract("node", value);

export { schemas };
