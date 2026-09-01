import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const evidencePath=path.join(root,"docs","SURVIVOR_LIVE_ACCEPTANCE.json");
const required=[
  "deployedCumulativeBuild",
  "authenticatedDesktopPass",
  "authenticatedSecondDevicePass",
  "immediateRefreshPersistencePass",
  "logoutLoginPersistencePass",
  "liveResultPass",
  "weekRolloverPass",
  "mobilePass"
];

if(!fs.existsSync(evidencePath)){
  console.error("BLOCKED: docs/SURVIVOR_LIVE_ACCEPTANCE.json does not exist.");
  console.error("Complete the live acceptance checklist before retiring standalone Survivor.");
  process.exit(2);
}
const evidence=JSON.parse(fs.readFileSync(evidencePath,"utf8"));
const missing=required.filter(key=>evidence[key]!==true);
if(missing.length){
  console.error("BLOCKED: standalone Survivor retirement gate is not satisfied.");
  console.error("Missing:",missing.join(", "));
  process.exit(2);
}
if(!evidence.checkedAt||!evidence.deployment){
  console.error("BLOCKED: acceptance evidence must include checkedAt and deployment.");
  process.exit(2);
}
console.log("PASS: integrated PickGauge Survivor satisfies the retirement gate.");
console.log(`Deployment: ${evidence.deployment}`);
console.log(`Checked: ${evidence.checkedAt}`);
