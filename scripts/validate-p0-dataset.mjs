import { readFileSync } from "node:fs";

import { assertP0Dataset } from "../src/contracts.mjs";

const datasetUrl = new URL("../fixtures/p0-scenes.json", import.meta.url);
const dataset = JSON.parse(readFileSync(datasetUrl, "utf8"));

assertP0Dataset(dataset);

const sceneIds = new Set(dataset.map((scene) => scene.id));
const anchorIds = new Set(dataset.flatMap((scene) => scene.expected_anchors.map((anchor) => anchor.id)));
const expectedAnchorCount = dataset.reduce((total, scene) => total + scene.expected_anchors.length, 0);

if (sceneIds.size !== dataset.length) {
  throw new Error("P0 dataset contains duplicate scene IDs");
}
if (anchorIds.size !== expectedAnchorCount) {
  throw new Error("P0 dataset contains duplicate anchor IDs");
}

console.log(`P0 dataset valid: ${dataset.length} scenes, ${expectedAnchorCount} unique anchors`);
